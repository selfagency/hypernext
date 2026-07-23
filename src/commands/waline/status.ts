import { Command } from "@oclif/core";

export default class WalineStatus extends Command {
  static override args = {};

  static override description = "Check Waline server status";

  static override examples = ["$ hypernext waline status"];

  async run(): Promise<void> {
    // Access config via global - this is set after CLI init
    const { getConfig } = await import("../../config.js");
    const config = getConfig(process.cwd(), {});

    const waline = config.comments?.waline;
    if (!waline?.enabled) {
      this.log("Waline is not enabled in config");
      return;
    }

    const mode = waline.mode ?? "embedded";
    const port = waline.port ?? 8360;
    const serverUrl =
      mode === "embedded" ? `http://127.0.0.1:${port}` : waline.serverURL;

    this.log("\n📝 Waline Status\n");
    this.log(`  Mode:     ${mode}`);
    this.log(`  Server:   ${serverUrl}`);

    if (mode === "embedded") {
      this.log(`  Port:     ${port}`);

      // Check if process is running
      const { isWalineRunning } = await import(
        "../../comments/waline/process.js"
      );
      if (isWalineRunning()) {
        this.log("  Status:   Running");
      } else {
        this.log("  Status:   Not running");
      }
    }

    // Try health check
    try {
      const url = new URL("/api/comment", serverUrl);
      url.searchParams.set("type", "count");
      url.searchParams.set("path", "__health");

      const response = await fetch(url.toString());
      // Waline returns 400 even when healthy for invalid paths
      if (response.status === 400) {
        this.log("\n✓ Server is reachable\n");
      } else {
        this.log(`\n⚠ Server returned ${response.status}\n`);
      }
    } catch (err) {
      this.log(
        `\n✗ Server unreachable: ${err instanceof Error ? err.message : String(err)}\n`
      );
    }
  }
}
