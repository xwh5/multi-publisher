# Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## Development Setup

```bash
git clone <repo-url>
cd multi-publisher
pnpm install
pnpm run build
pnpm link
```

## Code Style

- Use TypeScript for all new code
- 2 spaces for indentation
- Run `pnpm run build` and `pnpm run typecheck` before committing

## Testing

```bash
# Build
pnpm run build

# Test specific command
pnpm exec tsx src/cli/index.ts platforms
pnpm exec tsx src/cli/index.ts render -f test.md
```

## Pull Request Process

1. Fork the repo and create your branch from `main`
2. Update CHANGELOG.md if applicable
3. Ensure the code builds successfully
4. Submit the PR
