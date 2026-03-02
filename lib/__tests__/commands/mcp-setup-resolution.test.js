import fs from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getServerConfig } from "../../commands/mcp-setup.js";

describe("mcp setup server config resolution", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("prefers local mcp-server script with current node executable", () => {
    const existsSyncSpy = vi
      .spyOn(fs, "existsSync")
      .mockImplementation((candidate) => {
        return String(candidate).endsWith("mcp-server/bin/mcp-server.js");
      });

    const config = getServerConfig();

    expect(config.command).toBe(process.execPath);
    expect(Array.isArray(config.args)).toBe(true);
    expect(config.args[0]).toContain("mcp-server/bin/mcp-server.js");
    expect(existsSyncSpy).toHaveBeenCalled();
  });

  it("falls back to npx package execution when no local script is found", () => {
    vi.spyOn(fs, "existsSync").mockReturnValue(false);

    const config = getServerConfig();

    expect(config.command).toBeTruthy();
    expect(config.args).toEqual(["-y", "@lpm-registry/mcp-server@latest"]);
  });

  it("adds LPM_REGISTRY_URL env when using a custom registry URL", () => {
    vi.spyOn(fs, "existsSync").mockReturnValue(false);

    const config = getServerConfig("http://localhost:3000");

    expect(config.env).toEqual({ LPM_REGISTRY_URL: "http://localhost:3000" });
  });
});
