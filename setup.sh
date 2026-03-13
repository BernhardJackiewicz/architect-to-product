#!/bin/bash
set -e

echo "=== architect-to-product Setup ==="
echo ""

# 1. Build the MCP server
echo "1/4 Building MCP server..."
npm install
npm run build
echo "    ✓ Built successfully"

# 2. Register architect-to-product in Claude Code
echo ""
echo "2/4 Registering architect-to-product MCP server..."
claude mcp add architect-to-product -- node "$(pwd)/dist/index.js"
echo "    ✓ Registered"

# 3. Install codebase-memory-mcp
echo ""
echo "3/4 Installing codebase-memory-mcp..."
ARCH=$(uname -m)
OS=$(uname -s | tr '[:upper:]' '[:lower:]')

if [ "$OS" = "darwin" ] && [ "$ARCH" = "arm64" ]; then
    BINARY="codebase-memory-mcp-darwin-arm64"
elif [ "$OS" = "darwin" ] && [ "$ARCH" = "x86_64" ]; then
    BINARY="codebase-memory-mcp-darwin-amd64"
elif [ "$OS" = "linux" ] && [ "$ARCH" = "x86_64" ]; then
    BINARY="codebase-memory-mcp-linux-amd64"
else
    echo "    ⚠ Unsupported platform: $OS/$ARCH"
    echo "    Download manually from https://github.com/DeusData/codebase-memory-mcp/releases"
    BINARY=""
fi

if [ -n "$BINARY" ]; then
    if command -v codebase-memory-mcp &>/dev/null; then
        echo "    ✓ Already installed"
    else
        curl -sL "https://github.com/DeusData/codebase-memory-mcp/releases/latest/download/$BINARY" -o /usr/local/bin/codebase-memory-mcp
        chmod +x /usr/local/bin/codebase-memory-mcp
        echo "    ✓ Installed to /usr/local/bin/codebase-memory-mcp"
    fi
    claude mcp add codebase-memory -- codebase-memory-mcp
    echo "    ✓ Registered in Claude Code"
fi

# 4. Check for Playwright MCP (optional)
echo ""
echo "4/4 Checking Playwright MCP (optional, for frontend E2E testing)..."
if npm list -g @playwright/mcp &>/dev/null 2>&1; then
    echo "    ✓ Already installed"
else
    echo "    ℹ Not installed. Install later with: npm install -g @playwright/mcp"
    echo "    ℹ Then register: claude mcp add playwright -- npx @playwright/mcp"
fi

echo ""
echo "=== Setup complete! ==="
echo ""
echo "Start a new project:"
echo "  1. Open Claude Code"
echo "  2. Use the a2p prompt"
echo "  3. Or call a2p_init_project directly"
echo ""
