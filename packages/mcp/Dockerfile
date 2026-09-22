# @agtnames/mcp as a container (Docker MCP Catalog submission, #362). Runs the published npm package over stdio.
#   docker build -t agtnames/mcp packages/mcp
#   docker run -i --rm agtnames/mcp
# Optional: -e AGT_RPC_URL=… -e AGT_CHAIN=polygon (defaults read Polygon mainnet).
FROM node:22-alpine
ARG AGT_MCP_VERSION=1.5.2
RUN npm install -g "@agtnames/mcp@${AGT_MCP_VERSION}" && npm cache clean --force
USER node
ENTRYPOINT ["agt-mcp"]
