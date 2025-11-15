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

# Start development servers
bun run dev
```

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
- No separate environment files needed for basic setup
- Use `.env.local` for development overrides
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
