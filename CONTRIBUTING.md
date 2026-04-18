# Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## Development Setup

```bash
git clone <repo-url>
cd multi-publisher
npm install
npm run build
npm link
```

## Code Style

- Use TypeScript for all new code
- 2 spaces for indentation
- Run `npm run build` before committing

## Testing

```bash
# Build
npm run build

# Test specific command
npx tsx src/index.ts platforms
npx tsx src/index.ts render -f test.md
```

## Pull Request Process

1. Fork the repo and create your branch from `main`
2. Update CHANGELOG.md if applicable
3. Ensure the code builds successfully
4. Submit the PR
