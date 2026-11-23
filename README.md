# Tensrai Dashboard

A modern monorepo for real-time robot monitoring, teleoperation, and mission management with ROS 2 integration.

## 🏗️ Architecture

- **Frontend**: React 19 + Vite + TypeScript + Tailwind CSS + shadcn UI
- **Backend**: Fastify + TypeScript + Node.js
- **Shared**: Common types and utilities
- **Tooling**: Bun workspaces, Biome linting/formatting, Husky hooks
- **Real-time**: Socket.io, ROS bridge WebSocket connections

## 🚀 Quick Start

### Prerequisites

- [Bun](https://bun.sh) (>= 1.0.0)
- Git

### Installation

```bash
# Clone and setup
git clone <repository-url>
cd tensrai_dashboard
bun install

# Setup git hooks
bun run prepare

# Settings for running on this machine (Docker Compose ignores this file)
cp .env.local.example .env.local

# Start development servers: UI on http://localhost:5002, API on http://localhost:5055
bun run dev
```

`bun run dev` uses your local MongoDB if `mongod` is installed, otherwise it starts the one from
`docker-compose.yml` (so Docker needs to be running). Each start also syncs the schema.

From the repo root, `bun run backend <script>` runs any backend script with these settings.

### Default staff account

The first login on any deployment is `admin@tensrai.com`, whose username is that address. Its first password is
set once, by whoever looks after the repo:

```bash
bun run backend staff:default-password
```

That asks for a password (hidden) and writes only its bcrypt hash to
`backend/scripts/defaultStaffPassword.hash`, which you commit. **This repo is public, so the hash is too.** Use
a long random password, keep it in a password manager, and never reuse it.

A deployment that has no staff at all creates the account when it starts, from that hash. There's nothing to set
up on the server, but until someone signs in, anyone who knows the password can take the account, so:

1. Sign in straight after deploying. You'll have to choose a new password, and the committed one stops working.
2. If nobody signs in within 72 hours, the first password expires.

To set or reset a password yourself, including after it expires, run one of these. Nothing you type is shown,
and it signs the account out everywhere:

```bash
bun run backend staff:create
```

```bash
docker compose exec backend sh -c 'cd backend && bunx tsx scripts/createStaff.ts'
```

Changing the committed hash only affects new deployments. Deleting the only staff account means the next start
creates it again from the hash.

If another user already has `admin@tensrai.com`, for example a demo admin from an older seed, the account isn't
created and the seed tells you to run `staff:create`. That turns the existing user into staff, under its own
username.

To also seed demo accounts, set `SEED_ADMIN_*` / `SEED_USER_*` (`EMAIL`, `USERNAME`, `DISPLAY_NAME`,
`PASSWORD`). An account with no password set isn't created, and existing accounts are never changed.

### Organizations (multi-tenancy)

All customers share one deployment and database. Everything belongs to an organization, its admins control it, and the API only ever returns the signed-in user's organization.

- **Org admins** manage their users and robots, including robot IP, ports and channels.
- **Any member** of the organization that owns a robot can operate it: teleop, missions, e-stop, active map, and edit and sync its maps. Deleting a map needs an admin.
- **Tensrai staff** use the Organizations screen: create organizations and first admins, approve robot addresses, enter an organization for support, move a robot between organizations. The API never grants this role:

```bash
bun run backend staff:create someone someone@tensrai.com                    # create a staff user, or promote an existing one
bun run backend org:create "Acme Robotics" acme acme-admin admin@acme.com   # also possible from the screen
```

**Robot addresses.** Robot bridges have no auth, so whatever the backend connects to obeys it. An org admin can enter any address, but the backend won't connect to it until staff approve it for that organization. Then the address belongs to that organization until staff release it, even if the robot is deleted. Set `ROBOT_BLOCKED_SUBNETS` (comma-separated CIDRs, empty for none) to change which internal ranges are refused, for example to use a local simulator. `MAX_ROBOTS_PER_ORG` limits robots per organization (default 50).

**Simulated robots.** To try everything without hardware, `bun run robots` starts a separate stack at http://127.0.0.1:18090 with three simulated robots, which come back whenever Docker restarts. Add them like any real robot, with New Robot and staff approval: `10.77.0.11` has `map 1`, `10.77.0.12` has `map 2` and `10.77.0.13` has `map 3`. `bun run robots:stop` stops the stack and keeps its data; to start over, also run `docker compose -p dashboard-robots -f docker-compose.yml -f tools/e2e/compose-robots.yml down -v`. Deployments never get these robots, and `bun run dev` can't reach them because its backend runs outside Docker.

**Adding a new resource.** Give the model an `orgId` and query it through `request.db` in routes. A model with no `orgId` fails on its first query, and a test fails until it is either given one or listed as global in `backend/src/services/orgScope.ts`.

**Deploying.** The Docker backend runs `prisma db push` and `backfill:org` on every start, before seeding, so upgrading an existing install needs no manual step: existing data moves to a "Default" organization and existing robot addresses are approved. Run them yourself when deploying another way. Usernames and emails are unique across all organizations; robot names are unique per organization. Within an organization, robots share a map record only when the image, the YAML and the tags, missions and zones all match, so two robots can each keep a different `map.yaml`. The start also runs `backfill:map-revisions`, which fills what that comparison needs on maps stored before it.

**Tests that need a database** run separately, against a Mongo replica set with the schema pushed:

```bash
cd backend
TEST_DATABASE_URL='mongodb://localhost:27017/tenancy_test?replicaSet=rs0' bun run test:integration
```

### Maps

The **Maps** page lists every map in the organization with the robots that have it. Members can view, edit and sync maps; deleting one needs an admin.

- **Upload** a map from its `.pgm` and `.yaml` (and `metadata.json` for tags and missions), or **Import from robot** to bring in the maps a robot made itself.
- **Edit** opens the map editor. With no tool chosen, drag to pan and scroll to zoom. **Draw** (B) paints obstacles and **Eraser** (E) clears them; Shift-click draws a straight line. **Zone** (Z), **Path** (P) and **Tag** (T) add no-go, work, named, trigger, pick and drop zones, preferred paths and virtual walls, and mission and home tags. The More menu crops the map, edits its YAML and downloads it. Saving refuses a tag inside a no-go zone and an edit made on top of someone else's save.
- **Merge maps**, in the More menu, joins maps of neighbouring areas into a new one: drag a layer into place, turn it by its handle, or line it up by clicking two features on both maps.
- **Assign** sends a map to robots, and removing a robot there deletes the map from it; it says beforehand which file each robot will get and which missions would clash. **Sync** sends the latest saved version to the robots that have an older one. Each robot shows its state on the map's row: up to date, syncing, failed, or changed on the robot too, where **Resolve** shows what each copy has and asks you to choose one.
- On a phone, maps show as cards: you can assign, sync and resolve there, while editing and merging need a larger screen.

Saving only changes the dashboard's copy; robots get it when you sync. No-go zones, virtual walls and preferred paths reach the robot as a Nav2 keepout mask beside the map. [docs/robot-map-protocol.md](docs/robot-map-protocol.md) is the spec for the robot side; until a robot supports it, its chip says it can't receive maps yet, and importing from it still works.

### Development Workflow

```bash
# Individual project development
bun run dev:frontend    # Frontend only
bun run dev:backend     # Backend only

# Build all projects
bun run build

# Code quality
bun run lint            # Check code quality
bun run lint:fix        # Fix linting issues
bun run format:write    # Format all code
bun run type-check      # TypeScript type checking

# Health check
bun run health-check    # Run full quality check
```

## 📁 Project Structure

```
tensrai_dashboard/
├── frontend/            # React 19 frontend application
├── backend/            # Fastify backend API
├── shared/             # Shared types and utilities
├── .vscode/            # VS Code workspace settings
├── .husky/             # Git hooks
├── biome.json          # Biome configuration
├── bunfig.toml         # Bun configuration
├── tsconfig.json       # Workspace TypeScript config
└── package.json        # Workspace configuration
```

## 🛠️ Development Tools

### Biome Configuration
- **Linting**: Modern, fast replacement for ESLint
- **Formatting**: Opinionated formatting (replaces Prettier)
- **Organization**: Automatic import sorting
- **Project-specific overrides**: Different rules for frontend/backend

### TypeScript Project References
- **Composite builds**: Faster incremental compilation
- **Type sharing**: Shared types in `@tensrai/shared`
- **Path aliases**: Clean imports between packages
- **Strict configuration**: Maximum type safety

### Git Hooks (Husky)
- **Pre-commit**: Type checking and linting
- **Pre-push**: Full build validation
- **Automated**: Ensures code quality before commits

### VS Code Integration
- **Workspace settings**: Optimized for monorepo
- **Debug configurations**: Multi-project debugging
- **Recommended extensions**: Essential tooling
- **Tasks**: Automated build and test workflows

## 📦 Package Management

### Workspace Dependencies
- **Hoisted devDependencies**: Shared tools at root level
- **Workspace protocol**: Internal package linking
- **TypeScript workspace**: Consistent across all packages
- **Biome workspace**: Single configuration for all projects

### Build Order
1. `shared` - Types and utilities
2. `backend` - Fastify server
3. `frontend` - React application

## 🔧 Configuration Files

### Key Files
- `bunfig.toml` - Bun configuration with caching and hoisting
- `biome.json` - Linting and formatting rules
- `tsconfig.json` - Workspace TypeScript configuration
- `package.json` - Workspace scripts and dependencies

### Environment Setup
- `.env` configures Docker Compose; `.env.local` overrides it when running on your machine
- Start from `.env.local.example`, and change its port if 5055 is taken
- Environment variables documented in each package

## 🎯 Scripts Overview

### Root Level Scripts
- `dev` - Start all development servers in parallel
- `build` - Build all packages in dependency order
- `health-check` - Full quality validation
- `clean` - Remove all build artifacts and dependencies

### Quality Assurance
- `lint` - Biome linting across all packages
- `format` - Code formatting with Biome
- `type-check` - TypeScript validation
- Pre-commit hooks ensure quality automatically

## 📚 API Documentation

### Shared Types
Located in `shared/src/types.ts`:
- `Robot` - Robot metadata and status
- `Mission` - Mission management

### Backend API
- REST endpoints for CRUD operations
- WebSocket namespaces for real-time updates
- ROS bridge integration for robot communication
- Authentication and authorization middleware

### Frontend Components
- React 19 with latest features
- Tailwind CSS for styling
- shadcn/ui components
- Real-time telemetry display

## 🚀 Deployment

### Build Process
```bash
# Production build
bun run build

# Output directories
./frontend/dist/    # Frontend build
./backend/dist/     # Backend build
./shared/dist/      # Shared types
```

### Environment Variables
```bash
NODE_ENV=production
PORT=3001          # Backend port
FRONTEND_URL=http://localhost:5173
```

### Cloud Teleop Latency Tuning

For AWS-hosted dashboard teleop over weak mobile robot-site networks, keep movement commands
publishable and reduce competing traffic instead of dropping teleop commands.

Frontend command cadence is a build-time value:

```bash
VITE_ROS_TELEOP_RATE_HZ=4  # baked image default; use 4-5 for weak mobile links
```

Backend telemetry throttles are runtime values:

```bash
ROS_LASER_RATE_HZ=1
ROS_MAX_LASER_POINTS=120
ROS_ODOM_RATE_HZ=4
ROS_SCAN_POSE_RATE_HZ=4
ROS_AMCL_RATE_HZ=2
ROS_TELEOP_STALE_WARN_MS=1000
```

When diagnosing a bad session, inspect `ROS bridge command received/published` logs. High
`ageMs` means the command was already stale when AWS received it; low `ageMs` with delayed robot
motion points to the AWS-to-site ROS bridge/mobile-network leg.

## 📈 Observability (OpenTelemetry + SigNoz)

Run the bundled SigNoz stack and stream backend traces via OTLP:

1. **Start SigNoz locally**
   ```bash
   cd infra/signoz
   docker compose up -d
   ```
   SigNoz UI is available at http://localhost:3301 (collector listening on gRPC `4317`).

2. **Configure the backend** – add the following to `backend/.env` (or your process env):
   ```env
   OTEL_SERVICE_NAME=tensrai-backend
   OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4317
   # Optional: send custom headers, e.g. tokens -> key=value,key2=value2
   # OTEL_EXPORTER_OTLP_HEADERS=x-scope-orgID=tensrai
   ```

3. **Start the backend** – `bun run dev:backend` (or `bun run dev`). The `src/otel.ts` bootstrap sends all Fastify auto-instrumented traces to the SigNoz collector automatically.

Check SigNoz → Traces to confirm data is arriving. Use `docker compose logs -f otel-collector` for troubleshooting.

## 🔍 Troubleshooting

### Common Issues
1. **Installation**: Run `bun install` from root directory
2. **Type errors**: Check `shared` package builds first
3. **Linting**: Use `bun run lint:fix` for automatic fixes
4. **Build failures**: Run `bun run clean` then `bun install`

### Development Tips
- Use VS Code workspace for optimal experience
- Run `bun run health-check` before committing
- Check git hooks if issues arise
- Use workspace protocol for internal dependencies

All commits are automatically validated with:
- TypeScript type checking
- Biome linting and formatting
- Build validation
