// SPDX-License-Identifier: GPL-3.0-or-later

import { exec, execSync } from "child_process";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { Builder, By, until } from "selenium-webdriver";
import safari from "selenium-webdriver/safari.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, "..");

const testResultsDir = join(projectRoot, "test-results");
if (!existsSync(testResultsDir)) {
  mkdirSync(testResultsDir, { recursive: true });
}

let devServerProcess = null;

async function startDevServer() {
  console.log("Checking if port 5173 is already active...");
  try {
    execSync("lsof -i :5173");
    console.log(
      "Port 5173 is already in use. Assuming dev server is already running.",
    );
    return;
  } catch (err) {
    console.log("Starting local Vite dev server on port 5173...");
    devServerProcess = exec("pnpm dev", { cwd: projectRoot });
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
}

function stopDevServer() {
  if (devServerProcess) {
    console.log("Stopping Vite dev server...");
    devServerProcess.kill();
  }
}

async function runTest() {
  console.log("Initializing Safari WebDriver...");
  let driver;
  try {
    const options = new safari.Options();
    driver = await new Builder()
      .forBrowser("safari")
      .setSafariOptions(options)
      .build();
  } catch (error) {
    console.error("\n❌ Failed to initialize Safari WebDriver.");
    console.error("Make sure Safari Remote Automation is enabled on your Mac.");
    console.error("Run this command to enable it:");
    console.error("  sudo safaridriver --enable\n");
    console.error("Original Error:", error.message);
    process.exit(1);
  }

  try {
    const url = "http://localhost:5173/";
    console.log(`Navigating to ${url}...`);
    await driver.get(url);

    // Wait for the main shell component to render
    console.log("Waiting for webmmd-app-shell to load...");
    const appShell = await driver.wait(
      until.elementLocated(By.css("webmmd-app-shell")),
      10000,
    );

    const shadowRoot = await appShell.getShadowRoot();

    // 1. Initial UI Checks
    console.log("Verifying initial UI state...");
    const logoEl = await shadowRoot.findElement(By.css(".logo"));
    const logoText = await logoEl.getText();
    console.log(`- Logo brand: "${logoText}"`);
    if (logoText !== "WebMMD") {
      throw new Error(
        `Expected logo brand to be "WebMMD" but got "${logoText}"`,
      );
    }

    const versionEl = await shadowRoot.findElement(By.css(".version-tag"));
    const versionText = await versionEl.getText();
    console.log(`- Version: "${versionText}"`);

    // Capture initial load screenshot
    let screenshotData = await driver.takeScreenshot();
    writeFileSync(
      join(testResultsDir, "safari-1-initial-load.png"),
      screenshotData,
      "base64",
    );
    console.log("Saved initial load screenshot.");

    // 2. Upload ZIP Model file (which contains multiple models)
    const zipFilePath = join(projectRoot, "ref", "test.zip");
    if (!existsSync(zipFilePath)) {
      throw new Error(`ZIP fixture not found at: ${zipFilePath}`);
    }

    console.log(`Uploading ZIP file: ${zipFilePath}...`);
    const fileInput = await shadowRoot.findElement(By.css("#file-input"));
    await fileInput.sendKeys(zipFilePath);

    // 3. Wait for PMX selection overlay to appear
    console.log("Waiting for PMX selector overlay...");
    const selectorOverlay = await driver.wait(async () => {
      try {
        const overlay = await shadowRoot.findElement(
          By.css(".pmx-selector-overlay"),
        );
        if (await overlay.isDisplayed()) {
          return overlay;
        }
      } catch (err) {
        // Gracefully ignore NoSuchElementError while polling
      }
      return false;
    }, 10000);
    console.log("Selector overlay is visible!");

    // Find all model buttons inside card
    const optionButtons = await shadowRoot.findElements(
      By.css(".pmx-option-btn"),
    );
    console.log(`Found ${optionButtons.length} PMX model options in ZIP file.`);

    let targetButton = null;
    for (const btn of optionButtons) {
      const text = await btn.getText();
      console.log(`- Option: "${text}"`);
      if (text.includes("【琳妮特】.pmx")) {
        targetButton = btn;
      }
    }

    if (!targetButton) {
      throw new Error(
        "Could not find Lynette model button in PMX Selector overlay.",
      );
    }

    // Capture selector screen
    screenshotData = await driver.takeScreenshot();
    writeFileSync(
      join(testResultsDir, "safari-2-selector-overlay.png"),
      screenshotData,
      "base64",
    );
    console.log("Saved selector overlay screenshot.");

    // Click on target model button
    console.log('Selecting "【琳妮特】.pmx" model...');
    await targetButton.click();

    console.log("Waiting for model parsing and GPU uploading...");
    // We expect the canvas to obtain the "active" class once loaded
    const canvas = await shadowRoot.findElement(By.css("#gpu-canvas"));
    await driver.wait(async () => {
      const cls = await canvas.getAttribute("class");
      return cls && cls.includes("active");
    }, 15000);
    console.log("GPU Canvas is active and rendering model!");

    // Allow textures to load, decode, and render completely
    console.log("Waiting 5s for texture loading and rendering to stabilize...");
    await new Promise((resolve) => setTimeout(resolve, 5000));

    // 4. Inspect metadata loading in Sidebar
    console.log("Inspecting inspector panel for model info...");
    const inspector = await shadowRoot.findElement(By.css("webmmd-inspector"));
    const inspectorShadow = await inspector.getShadowRoot();

    const summaryTitle = await inspectorShadow.findElement(By.css("h2"));
    const summaryTitleText = await summaryTitle.getText();
    console.log(`- Model title loaded in inspector: "${summaryTitleText}"`);
    if (!summaryTitleText.includes("Linette")) {
      throw new Error(
        `Model title in inspector "${summaryTitleText}" does not match "Linette"`,
      );
    }

    // Capture model rendered screenshot
    screenshotData = await driver.takeScreenshot();
    writeFileSync(
      join(testResultsDir, "safari-3-model-rendered.png"),
      screenshotData,
      "base64",
    );
    console.log("Saved model rendered screenshot.");

    console.log("\n✅ Safari Web Automation verification PASSED!");
  } catch (error) {
    console.error("\n❌ Verification Failed:", error.stack || error);
    if (driver) {
      try {
        const browserErrors = await driver.executeScript(
          "return window.errors || [];",
        );
        if (browserErrors.length > 0) {
          console.error("\n🚨 Captured Browser Errors:");
          browserErrors.forEach((err) => {
            console.error(`- [${err.type}] ${err.message}`);
          });
        } else {
          console.log("\n(No browser errors captured in window.errors)");
        }

        const errorScreenshot = await driver.takeScreenshot();
        writeFileSync(
          join(testResultsDir, "safari-error.png"),
          errorScreenshot,
          "base64",
        );
        console.log("Saved error screenshot.");
      } catch (err) {
        console.error("Could not save error screenshot:", err.message);
      }
    }
    process.exitCode = 1;
  } finally {
    if (driver) {
      try {
        const logs = await driver.executeScript(
          "return window.consoleLogs || [];",
        );
        console.log("\n🌐 --- BROWSER CONSOLE LOGS ---");
        logs.forEach((l) => {
          console.log(`[Browser ${l.type.toUpperCase()}] ${l.message}`);
        });
        console.log("--------------------------------\n");
      } catch (err) {
        console.error("Could not retrieve browser console logs:", err.message);
      }
      console.log("Quitting Safari driver...");
      await driver.quit();
    }
  }
}

async function main() {
  await startDevServer();
  try {
    await runTest();
  } finally {
    stopDevServer();
  }
}

main().catch((err) => {
  console.error("Fatal execution error:", err);
  stopDevServer();
  process.exit(1);
});
