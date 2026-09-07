# agt — Claude Code plugin (testbed)

Brings `.agt` agent names into Claude Code via the `@agt/mcp` server. The same MCP server works in any MCP-compatible client; this folder just packages it as a Claude Code plugin with a skill that teaches Claude when to use it.

## Quick start (local testbed)

```
# 1. build the packages
cd packages/resolver && npm install && npm run build
cd ../mcp && npm install && npm run build

# 2. run the chain + testbed (two terminals, from contracts/)
npx hardhat node
npx hardhat run scripts/testbed.cjs --network localhost      # prints AGT_REGISTRY

# 3. point Claude Code at it (either way works)
set AGT_RPC_URL=http://127.0.0.1:8545
set AGT_REGISTRY=<address from step 2>
claude mcp add agt -- node packages/mcp/dist/index.js
#   or load this folder as a plugin: claude --plugin-dir packages/claude-plugin
```

Then in Claude Code: *"who owns exampleagent.agt and what's its MCP endpoint?"*

## Files

- `.claude-plugin/plugin.json` — plugin manifest
- `.mcp.json` — registers the `agt` MCP server (uses `${CLAUDE_PLUGIN_ROOT}` and env vars)
- `skills/agt/SKILL.md` — when/how Claude should use the tools; verification-first guidance
