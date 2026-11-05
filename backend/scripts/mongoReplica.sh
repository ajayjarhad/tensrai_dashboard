#!/bin/bash

# MongoDB Replica Set Manager
# Ensures MongoDB runs in replica set mode for Prisma operations

set -e

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

# Configuration
# Homebrew lives in /usr/local on Intel Macs and /opt/homebrew on Apple Silicon.
BREW_PREFIX="$(brew --prefix 2>/dev/null || echo /usr/local)"
MONGO_CONFIG="$BREW_PREFIX/etc/mongod.conf"
MONGO_LOG="$BREW_PREFIX/var/log/mongodb/mongo.log"
MONGO_DBPATH="$BREW_PREFIX/var/mongodb"
REPLICA_SET_NAME="rs0"
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

# Functions
log_info() { echo -e "${GREEN}✓${NC} $1"; }
log_warn() { echo -e "${YELLOW}⚠${NC} $1"; }
log_error() { echo -e "${RED}✗${NC} $1"; }

check_mongo_running() {
  pgrep -f mongod > /dev/null
}

check_replica_mode() {
  mongosh --quiet --eval "try { rs.status().ok } catch(e) { 0 }" 2>/dev/null
}

create_mongo_config() {
  local config_file=$1
  mkdir -p "$(dirname "$MONGO_LOG")" "$MONGO_DBPATH"

  cat > "$config_file" << EOF
systemLog:
  destination: file
  path: $MONGO_LOG
  logAppend: true
storage:
  dbPath: $MONGO_DBPATH
net:
  bindIp: localhost
  port: 27017
replication:
  replSetName: $REPLICA_SET_NAME
EOF
}

start_mongo_replica() {
  local config_file=$1
  mongod --config "$config_file" > /dev/null 2>&1 &
  sleep 3
}

initialize_replica_set() {
  mongosh --quiet --eval "
    try {
      rs.initiate({
        _id: '$REPLICA_SET_NAME',
        members: [{_id: 0, host: 'localhost:27017'}]
      });
      print('Initialized');
    } catch (e) {
      if (e.codeName === 'AlreadyInitialized') {
        print('AlreadyInitialized');
      } else {
        throw e;
      }
    }
  " 2>/dev/null
}

configure_permanent() {
  echo -e "${YELLOW}🔧 Configuring MongoDB for permanent replica set mode...${NC}"
  
  # Stop MongoDB
  brew services stop mongodb-community 2>/dev/null || true
  pkill -f mongod 2>/dev/null || true
  sleep 2
  
  # Create permanent config
  log_info "Creating configuration at $MONGO_CONFIG"
  create_mongo_config "$MONGO_CONFIG"
  
  # Start with brew services
  log_info "Starting MongoDB with brew services"
  brew services start mongodb-community
  sleep 5
  
  # Initialize replica set
  result=$(initialize_replica_set)
  if [[ "$result" == *"Initialized"* ]] || [[ "$result" == *"AlreadyInitialized"* ]]; then
    log_info "Replica set initialized"
  fi
  
  echo ""
  log_info "MongoDB configured to start in replica set mode on boot"
  echo ""
  echo "  Status:  mongosh --eval 'rs.status()'"
  echo "  Logs:    tail -f $MONGO_LOG"
  echo ""
}

refuse_docker_only_url() {
  case "${DATABASE_URL:-}" in
    *://mongo:*)
      log_error "DATABASE_URL uses the host 'mongo', which only exists inside Docker."
      echo "  To run on this machine: cp .env.local.example .env.local"
      exit 1
      ;;
  esac
}

start_mongo_in_docker() {
  if ! docker info > /dev/null 2>&1; then
    log_error "MongoDB isn't installed and Docker isn't running."
    echo "  Start Docker Desktop, or install MongoDB: brew install mongodb-community"
    exit 1
  fi

  log_warn "MongoDB isn't installed here, using the Docker one..."
  local output
  if ! output=$(cd "$REPO_ROOT" && docker compose up -d mongo mongo-init 2>&1); then
    log_error "Could not start MongoDB in Docker:"
    echo "$output"
    exit 1
  fi
  # Not `docker compose wait`: it errors once the setup container has already exited.
  local state=""
  for _ in {1..60}; do
    state=$(cd "$REPO_ROOT" && docker compose ps -a --format '{{.State}} {{.ExitCode}}' mongo-init 2>/dev/null)
    case "$state" in
      exited*) break ;;
    esac
    sleep 1
  done
  if [ "$state" != "exited 0" ]; then
    log_error "MongoDB started, but setting up its replica set failed."
    echo "  See: docker compose logs mongo-init"
    exit 1
  fi
}

ensure_replica_mode() {
  refuse_docker_only_url
  echo -e "${YELLOW}🔍 Checking MongoDB replica set...${NC}"

  if ! command -v mongod > /dev/null 2>&1; then
    start_mongo_in_docker
  elif ! check_mongo_running; then
    log_warn "MongoDB not running, starting in replica set mode..."
    
    create_mongo_config "/tmp/mongod-replica.conf"
    start_mongo_replica "/tmp/mongod-replica.conf"
    
    result=$(initialize_replica_set)
    if [[ "$result" == *"Initialized"* ]] || [[ "$result" == *"AlreadyInitialized"* ]]; then
      log_info "Replica set initialized"
    fi
  else
    # MongoDB is running, check if it's a replica set
    if [ "$(check_replica_mode)" == "1" ]; then
      log_info "MongoDB replica set already running"
    else
      log_warn "MongoDB running in standalone mode, restarting as replica set..."
      
      pkill -f mongod
      sleep 2
      
      create_mongo_config "/tmp/mongod-replica.conf"
      start_mongo_replica "/tmp/mongod-replica.conf"
      
      result=$(initialize_replica_set)
      if [[ "$result" == *"Initialized"* ]] || [[ "$result" == *"AlreadyInitialized"* ]]; then
        log_info "Replica set initialized"
      fi
    fi
  fi
  
  log_info "MongoDB replica set ready"
}

show_help() {
  cat << EOF
MongoDB Replica Set Manager

Usage: $0 [OPTIONS]

OPTIONS:
  (no args)       Ensure MongoDB is running in replica set mode (default)
  --permanent     Configure MongoDB to start in replica set mode on boot
  --status        Show current MongoDB replica set status
  --help          Show this help message

Examples:
  $0                    # Auto-start/restart MongoDB in replica set mode
  $0 --permanent        # Configure for boot
  $0 --status           # Check status

EOF
}

show_status() {
  if ! check_mongo_running; then
    log_error "MongoDB is not running"
    exit 1
  fi
  
  if [ "$(check_replica_mode)" == "1" ]; then
    log_info "MongoDB is running in replica set mode"
    echo ""
    mongosh --quiet --eval "rs.status()" | head -20
  else
    log_warn "MongoDB is running in standalone mode (not replica set)"
  fi
}

# Main
case "${1:-}" in
  --permanent)
    configure_permanent
    ;;
  --status)
    show_status
    ;;
  --help|-h)
    show_help
    ;;
  "")
    ensure_replica_mode
    ;;
  *)
    log_error "Unknown option: $1"
    show_help
    exit 1
    ;;
esac
