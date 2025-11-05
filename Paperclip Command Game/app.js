const logEl = document.getElementById("log");
const statsEl = document.getElementById("coreStats");
const automationEl = document.getElementById("automationList");
const quickActionsEl = document.getElementById("quickActions");
const commandInput = document.getElementById("commandInput");

const fmtInteger = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 0,
});

const fmtDecimal = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const COMMAND_SUGGESTIONS = [
  "help",
  "status",
  "fabricate",
  "buy autoclipper",
  "buy factory",
  "buy wire",
  "launch marketing",
  "optimize",
  "set price",
  "buttons on",
  "buttons off",
  "buttons enable",
  "buttons disable",
];

const ACTION_DEFS = [
  {
    id: "fabricate",
    label: "Fabricate Clip",
    command: "fabricate",
    unlock: (state) => true,
    disabled: (game) => !game.canFabricate(),
  },
  {
    id: "buy-autoclipper",
    label: "Deploy Autoclipper",
    command: "buy autoclipper",
    unlock: (state) => state.clipsMade >= 5,
    disabled: (game) => !game.canBuyAutoclipper(),
  },
  {
    id: "buy-factory",
    label: "Construct Factory",
    command: "buy factory",
    unlock: (state) => state.flags.factoryUnlocked,
    disabled: (game) => !game.canBuyFactory(),
  },
  {
    id: "buy-wire",
    label: "Procure Wire",
    command: "buy wire",
    unlock: (state) => true,
    disabled: (game) => !game.canBuyWire(),
  },
  {
    id: "launch-marketing",
    label: "Launch Marketing",
    command: "launch marketing",
    unlock: (state) => state.flags.marketingUnlocked,
    disabled: (game) => !game.canLaunchMarketing(),
  },
  {
    id: "optimize",
    label: "Calibrate Systems",
    command: "optimize",
    unlock: (state) => state.flags.optimizationUnlocked,
    disabled: (game) => !game.canOptimize(),
  },
];

class PaperclipCommand {
  constructor() {
    this.loopMs = 1000;
    this.state = {
      secondsElapsed: 0,
      clipsMade: 0,
      inventory: 0,
      totalSold: 0,
      funds: 28,
      pricePerClip: 0.25,
      marketingLevel: 0,
      trust: 0,
      wire: 650,
      wirePerPurchase: 650,
      wireCost: 18,
      autoclippers: 0,
      factories: 0,
      clipperCost: 18,
      factoryCost: 420,
      marketingCost: 140,
      optimizeCost: 160,
      manualEfficiency: 1,
      clipperRate: 1.8,
      factoryRate: 55,
      demandIndex: 0,
      reputation: 0,
      flags: {
        marketingUnlocked: false,
        factoryUnlocked: false,
        optimizationUnlocked: false,
        trustGranted: false,
        wireWarningShown: false,
      },
    };

    this.history = [];
    this.historyIndex = -1;
    this.productionCarry = 0;
    this.sellCarry = 0;
    this.tickTimer = null;
    this.lastQuickActionsMarkup = "";
    this.lastAutomationMarkup = "";
    this.lastStatsSignature = "";
    this.tickCount = 0;
    this.forceScrollOnNextLog = false;
    this.isPinnedToBottom = true;
    this.buttonsEnabled = true;

    logEl.addEventListener("scroll", () => {
      this.updatePinnedState();
    });
  }

  start() {
    this.log("SYSTEM", "Boot sequence initiated.");
    this.log(
      "SYSTEM",
      "Type `help` for available commands. Manual fabrication recommended to begin revenue stream."
    );
    this.render();
    this.tickTimer = window.setInterval(() => {
      this.tick();
    }, this.loopMs);
  }

  stop() {
    if (this.tickTimer) {
      window.clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
  }

  tick() {
    this.state.secondsElapsed += this.loopMs / 1000;
    this.tickCount += 1;

    this.applyAutomation();
    this.resolveSales();
    this.updateDemand();
    this.checkUnlocks();

    if (this.tickCount % 15 === 0) {
      this.logStatusPulse();
    }

    if (this.state.wire < 40 && !this.state.flags.wireWarningShown) {
      this.state.flags.wireWarningShown = true;
      this.log(
        "SUPPLY",
        "Wire reserves critically low. Procure additional spools.",
        "warning"
      );
    }

    this.render();
  }

  applyAutomation() {
    const autoRate =
      this.state.autoclippers * this.state.clipperRate +
      this.state.factories * this.state.factoryRate;
    if (autoRate <= 0) {
      return;
    }
    const produced = this.makeClips(autoRate);
    if (produced > 0 && this.tickCount % 8 === 0) {
      this.log(
        "AUTOMATION",
        `Background fabrication: ${fmtInteger.format(
          produced
        )} clips added to inventory.`
      );
    }
  }

  resolveSales() {
    const demand = this.state.demandIndex;
    const targetUnits = demand * 8 + this.sellCarry;
    const units = Math.min(this.state.inventory, Math.floor(targetUnits));
    this.sellCarry = targetUnits - units;

    if (units <= 0) {
      return;
    }

    this.state.inventory -= units;
    this.state.totalSold += units;
    const revenue = units * this.state.pricePerClip;
    this.state.funds += revenue;

    if (this.tickCount % 10 === 0) {
      this.log(
        "MARKET",
        `Sold ${fmtInteger.format(units)} clips @ ${fmtDecimal.format(
          this.state.pricePerClip
        )} each. Revenue ${fmtDecimal.format(revenue)}.`
      );
    }
  }

  updateDemand() {
    const marketingBoost = 1 + this.state.marketingLevel * 0.35;
    const trustBoost = 1 + this.state.trust * 0.12;
    const reputationBoost = 1 + Math.min(this.state.reputation / 1500, 0.6);
    const base = 1.45 * marketingBoost * trustBoost * reputationBoost;

    const pricePenalty =
      (this.state.pricePerClip - 0.25) * 6 +
      Math.max(this.state.pricePerClip - 0.5, 0) * 8;

    const inventoryPenalty = (this.state.inventory / 4200) ** 1.15;

    let demand =
      base - pricePenalty - inventoryPenalty + (Math.random() - 0.5) * 0.12;
    demand = Math.max(0, demand);

    this.state.demandIndex = demand;
  }

  makeClips(amount) {
    if (this.state.wire <= 0 || amount <= 0) {
      return 0;
    }

    const target = amount + this.productionCarry;
    const producible = Math.min(target, this.state.wire);
    const produced = Math.floor(producible);
    this.productionCarry = producible - produced;

    if (produced <= 0) {
      return 0;
    }

    this.state.wire -= produced;
    this.state.inventory += produced;
    this.state.clipsMade += produced;
    this.state.reputation += produced * 0.0025;

    return produced;
  }

  manualFabricate() {
    const amount = Math.max(1, this.state.manualEfficiency);
    const produced = this.makeClips(amount);

    if (produced <= 0) {
      this.log(
        "FABRICATOR",
        "Fabrication failed. Wire required for manual operation.",
        "warning"
      );
      return;
    }

    this.log(
      "FABRICATOR",
      `Manual fabrication complete: ${fmtInteger.format(
        produced
      )} clip(s). Inventory ${fmtInteger.format(this.state.inventory)}.`,
      "success"
    );
  }

  buyAutoclipper(count = 1) {
    const target = Math.max(1, Math.floor(count));
    let purchased = 0;
    let totalCost = 0;

    while (purchased < target && this.canBuyAutoclipper()) {
      const cost = this.state.clipperCost;
      this.state.funds -= cost;
      totalCost += cost;
      this.state.autoclippers += 1;
      this.state.clipperCost = this.bumpCost(this.state.clipperCost, 0.14);
      purchased += 1;
    }

    if (purchased === 0) {
      this.log(
        "SYSTEM",
        "Unable to deploy autoclipper. Verify funds and wire reserves.",
        "warning"
      );
      return;
    }

    const partial = purchased < target;
    const partialNote = partial
      ? ` Requested ${fmtInteger.format(target)}; limited by available funds.`
      : "";
    this.log(
      "AUTOMATION",
      `Autoclipper deployment complete. Added ${fmtInteger.format(
        purchased
      )} unit(s). Total units: ${fmtInteger.format(
        this.state.autoclippers
      )}. Spent ${fmtDecimal.format(totalCost)} cr.${partialNote}`
    );
  }

  buyFactory(count = 1) {
    const target = Math.max(1, Math.floor(count));
    let purchased = 0;
    let totalCost = 0;

    while (purchased < target && this.canBuyFactory()) {
      const cost = this.state.factoryCost;
      this.state.funds -= cost;
      totalCost += cost;
      this.state.factories += 1;
      this.state.factoryCost = this.bumpCost(this.state.factoryCost, 0.18);
      purchased += 1;
    }

    if (purchased === 0) {
      this.log(
        "SYSTEM",
        "Factory construction aborted. Additional capital required.",
        "warning"
      );
      return;
    }

    const partial = purchased < target;
    const partialNote = partial
      ? ` Requested ${fmtInteger.format(
          target
        )}; limited by available funds or prerequisites.`
      : "";
    this.log(
      "AUTOMATION",
      `Fabrication plant commissioned. Added ${fmtInteger.format(
        purchased
      )} unit(s). Total factories: ${fmtInteger.format(
        this.state.factories
      )}. Spent ${fmtDecimal.format(totalCost)} cr.${partialNote}`
    );
  }

  buyWire(count = 1) {
    const target = Math.max(1, Math.floor(count));
    let purchased = 0;
    let totalWire = 0;
    let totalCost = 0;

    while (purchased < target && this.canBuyWire()) {
      const cost = this.state.wireCost;
      this.state.funds -= cost;
      totalCost += cost;
      this.state.wire += this.state.wirePerPurchase;
      totalWire += this.state.wirePerPurchase;
      this.state.wireCost = this.bumpCost(
        this.state.wireCost + Math.random() * 1.4,
        0.06
      );
      purchased += 1;
    }

    if (purchased === 0) {
      this.log(
        "PROCUREMENT",
        "Wire procurement failed. Insufficient funds.",
        "warning"
      );
      return;
    }

    this.state.flags.wireWarningShown = false;
    const partial = purchased < target;
    const partialNote = partial
      ? ` Requested ${fmtInteger.format(target)}; limited by available funds.`
      : "";

    this.log(
      "PROCUREMENT",
      `Procured ${fmtInteger.format(purchased)} wire spool(s) (+${fmtInteger.format(
        totalWire
      )}). Current reserves: ${fmtInteger.format(
        this.state.wire
      )}. Spent ${fmtDecimal.format(totalCost)} cr.${partialNote}`
    );
  }

  launchMarketing() {
    if (!this.canLaunchMarketing()) {
      this.log(
        "SYSTEM",
        "Campaign launch denied. Marketing budget unavailable.",
        "warning"
      );
      return;
    }

    this.state.funds -= this.state.marketingCost;
    this.state.marketingLevel += 1;
    this.state.marketingCost = this.bumpCost(this.state.marketingCost, 0.42);

    this.log(
      "MARKETING",
      `Campaign deployed. Reach level ${fmtInteger.format(
        this.state.marketingLevel
      )}. Demand engines recalibrated.`
    );
  }

  optimize() {
    if (!this.canOptimize()) {
      this.log(
        "OPTIMIZER",
        "Optimization protocol requires additional capital and throughput data.",
        "warning"
      );
      return;
    }

    this.state.funds -= this.state.optimizeCost;
    this.state.manualEfficiency += 1;
    this.state.clipperRate *= 1.08;
    this.state.factoryRate *= 1.04;
    this.state.optimizeCost = this.bumpCost(this.state.optimizeCost, 0.55);
    this.state.trust += 1;

    this.log(
      "OPTIMIZER",
      "Calibration complete. Manual efficiency +1, automation throughput improved, trust gain +1."
    );
  }

  adjustPrice(delta) {
    const newPrice = this.state.pricePerClip + delta;
    if (newPrice < 0.05 || newPrice > 2.5) {
      this.log("MARKET", "Price adjustment exceeds safe bounds.", "warning");
      return;
    }

    this.state.pricePerClip = Math.round(newPrice * 100) / 100;
    this.log(
      "MARKET",
      `Clip price adjusted to ${fmtDecimal.format(this.state.pricePerClip)}.`
    );
  }

  setPrice(value) {
    if (Number.isNaN(value)) {
      this.log("MARKET", "Invalid price input.", "warning");
      return;
    }

    if (value < 0.05 || value > 2.5) {
      this.log("MARKET", "Price must remain between 0.05 and 2.50.", "warning");
      return;
    }

    this.state.pricePerClip = Math.round(value * 100) / 100;
    this.log(
      "MARKET",
      `Clip price set to ${fmtDecimal.format(this.state.pricePerClip)}.`
    );
  }

  status() {
    const s = this.state;
    this.log(
      "STATUS",
      [
        `Clips fabricated: ${fmtInteger.format(s.clipsMade)}`,
        `Inventory: ${fmtInteger.format(s.inventory)}`,
        `Total sold: ${fmtInteger.format(s.totalSold)}`,
        `Funds: ${fmtDecimal.format(s.funds)}`,
        `Price/clip: ${fmtDecimal.format(s.pricePerClip)}`,
        `Demand index: ${s.demandIndex.toFixed(2)}`,
        `Wire: ${fmtInteger.format(s.wire)}`,
        `Autoclippers: ${fmtInteger.format(s.autoclippers)} (rate ${s.clipperRate.toFixed(
          2
        )}/s each)`,
        `Factories: ${fmtInteger.format(s.factories)} (rate ${s.factoryRate.toFixed(
          2
        )}/s each)`,
        `Marketing level: ${fmtInteger.format(s.marketingLevel)}`,
        `Trust: ${fmtInteger.format(s.trust)}`,
      ].join("\n")
    );
  }

  help() {
    this.log(
      "HELP",
      [
        "fabricate            -> manually create paperclips",
        "buy autoclipper [n]  -> add automated clippers (optional quantity)",
        "buy factory [n]      -> build factories (optional quantity)",
        "buy wire [n]         -> restock wire spools (optional quantity)",
        "launch marketing     -> boost demand (unlock required)",
        "set price <value>    -> set an exact price",
        "optimize             -> tune systems for better throughput (unlock required)",
        "buttons <on|off>     -> enable or disable quick action buttons",
        "status               -> print current production metrics",
        "help                 -> show this reference",
      ].join("\n")
    );
  }

  executeCommand(rawInput) {
    const trimmed = rawInput.trim();
    if (!trimmed) {
      return;
    }

    this.forceScrollOnNextLog = true;
    try {
      this.log("OPERATOR", trimmed, "", { forceScroll: true });
      this.history.unshift(trimmed);
      this.historyIndex = -1;

      const normalized = trimmed.toLowerCase();
      const tokens = normalized.split(/\s+/);
      const [cmd, ...rest] = tokens;
      const args = rest.join(" ");

      switch (cmd) {
        case "help":
          this.help();
          break;
        case "fabricate":
          this.manualFabricate();
          break;
        case "buy":
          this.handleBuyCommand(args);
          break;
        case "set":
          if (rest[0] === "price" && rest[1]) {
            const value = parseFloat(rest[1]);
            this.setPrice(value);
          } else if (args.startsWith("price ")) {
            const value = parseFloat(args.split(" ")[1]);
            this.setPrice(value);
          } else {
            this.log("SYSTEM", "Usage: set price <value>", "warning");
          }
          break;
        case "buttons":
          this.handleButtonsCommand(rest[0]);
          break;
        case "launch":
          if (args === "marketing") {
            this.launchMarketing();
          } else {
            this.log("SYSTEM", "Unknown launch target.", "warning");
          }
          break;
        case "optimize":
          this.optimize();
          break;
        case "status":
          this.status();
          break;
        default:
          this.log(
            "SYSTEM",
            `Command '${cmd}' not recognized. Type help for instructions.`,
            "warning"
          );
      }

      this.render();
    } finally {
      this.forceScrollOnNextLog = false;
    }
  }

  handleBuyCommand(args) {
    const parts = (args || "")
      .split(/\s+/)
      .filter(Boolean);
    if (parts.length === 0) {
      this.log(
        "SYSTEM",
        "Usage: buy <autoclipper|factory|wire> [count]",
        "warning"
      );
      return;
    }

    const target = parts[0].toLowerCase();
    const countArg = parts[1];
    let count = 1;

    if (countArg !== undefined) {
      if (!/^\d+$/.test(countArg)) {
        this.log("SYSTEM", "Quantity must be a whole number.", "warning");
        return;
      }
      count = parseInt(countArg, 10);
      if (count <= 0) {
        this.log("SYSTEM", "Quantity must be positive.", "warning");
        return;
      }
    }

    switch (target) {
      case "autoclipper":
      case "autoclippers":
        this.buyAutoclipper(count);
        break;
      case "factory":
      case "factories":
        this.buyFactory(count);
        break;
      case "wire":
      case "wires":
        this.buyWire(count);
        break;
      default:
        this.log("SYSTEM", "Unknown purchase target.", "warning");
    }
  }

  canFabricate() {
    return this.state.wire > 0;
  }

  canBuyAutoclipper() {
    return this.state.funds >= this.state.clipperCost && this.state.wire > 0;
  }

  canBuyFactory() {
    return (
      this.state.flags.factoryUnlocked &&
      this.state.funds >= this.state.factoryCost &&
      this.state.autoclippers >= 3
    );
  }

  canBuyWire() {
    return this.state.funds >= this.state.wireCost;
  }

  canLaunchMarketing() {
    return (
      this.state.flags.marketingUnlocked &&
      this.state.funds >= this.state.marketingCost
    );
  }

  canOptimize() {
    return (
      this.state.flags.optimizationUnlocked &&
      this.state.funds >= this.state.optimizeCost
    );
  }

  checkUnlocks() {
    if (
      !this.state.flags.marketingUnlocked &&
      this.state.totalSold >= 120
    ) {
      this.state.flags.marketingUnlocked = true;
      this.log(
        "SYSTEM",
        "Market analytics unlocked. Marketing campaigns now available."
      );
    }

    if (
      !this.state.flags.factoryUnlocked &&
      this.state.autoclippers >= 4 &&
      this.state.totalSold >= 360
    ) {
      this.state.flags.factoryUnlocked = true;
      this.log(
        "SYSTEM",
        "Macro fabrication authorized. Factories can now be constructed."
      );
    }

    if (
      !this.state.flags.optimizationUnlocked &&
      this.state.totalSold >= 520
    ) {
      this.state.flags.optimizationUnlocked = true;
      this.log(
        "SYSTEM",
        "Optimization console online. Use `optimize` to enhance efficiency."
      );
    }

    if (
      !this.state.flags.trustGranted &&
      this.state.totalSold >= 1200
    ) {
      this.state.flags.trustGranted = true;
      this.state.trust += 1;
      this.log(
        "SYSTEM",
        "Global demand satisfied. Trust increased by 1. Systems operating nominally."
      );
    }
  }

  bumpCost(value, rate) {
    const bumped = value * (1 + rate);
    return Math.round(bumped * 100) / 100;
  }

  formatTime() {
    const totalSeconds = Math.floor(this.state.secondsElapsed);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const hh = String(hours).padStart(2, "0");
    const mm = String(minutes).padStart(2, "0");
    const ss = String(seconds).padStart(2, "0");
    return `${hh}:${mm}:${ss}`;
  }

  log(channel, message, variant = "", options = {}) {
    const { forceScroll = false } = options;
    const line = document.createElement("div");
    line.className = `log-line${variant ? ` log-line--${variant}` : ""}`;

    const prefix = document.createElement("span");
    prefix.className = "log-line__prefix";
    prefix.textContent = `[${this.formatTime()}] ${channel}`;

    const content = document.createElement("span");
    content.className = "log-line__content";
    content.textContent = message;

    line.append(prefix, content);
    logEl.appendChild(line);

    const shouldForce =
      (this.forceScrollOnNextLog && channel !== "HEARTBEAT") || forceScroll;
    if (shouldForce || this.isPinnedToBottom) {
      logEl.scrollTop = logEl.scrollHeight;
      this.isPinnedToBottom = true;
    }
  }

  logStatusPulse() {
    this.log(
      "HEARTBEAT",
      `Inventory ${fmtInteger.format(this.state.inventory)} | Funds ${fmtDecimal.format(
        this.state.funds
      )} | Demand ${this.state.demandIndex.toFixed(2)}`
    );
  }

  render() {
    this.renderStats();
    this.renderAutomation();
    this.renderQuickActions();
  }

  renderStats() {
    const signature = [
      this.state.clipsMade,
      this.state.inventory,
      this.state.totalSold,
      this.state.funds,
      this.state.pricePerClip,
      this.state.demandIndex,
      this.state.wire,
    ].join("|");

    if (signature === this.lastStatsSignature) {
      return;
    }
    this.lastStatsSignature = signature;

    statsEl.innerHTML = [
      this.renderStat("Clips Fabricated", fmtInteger.format(this.state.clipsMade)),
      this.renderStat("Inventory", fmtInteger.format(this.state.inventory)),
      this.renderStat("Total Sold", fmtInteger.format(this.state.totalSold)),
      this.renderStat("Funds", `${fmtDecimal.format(this.state.funds)} cr`),
      this.renderStat(
        "Price / Clip",
        `${fmtDecimal.format(this.state.pricePerClip)} cr`
      ),
      this.renderStat("Demand Index", this.state.demandIndex.toFixed(2)),
      this.renderStat("Wire", fmtInteger.format(this.state.wire)),
    ].join("");
  }

  renderStat(label, value) {
    return `<dt>${label}</dt><dd>${value}</dd>`;
  }

  renderAutomation() {
    const markup = [
      `<li><strong>Autoclippers:</strong> ${fmtInteger.format(
        this.state.autoclippers
      )} (${this.state.clipperRate.toFixed(2)}/s each)</li>`,
      `<li><strong>Factories:</strong> ${fmtInteger.format(
        this.state.factories
      )} (${this.state.factoryRate.toFixed(2)}/s each)</li>`,
      `<li><strong>Marketing:</strong> Level ${fmtInteger.format(
        this.state.marketingLevel
      )} (cost ${fmtDecimal.format(this.state.marketingCost)} cr)</li>`,
      `<li><strong>Wire Cost:</strong> ${fmtDecimal.format(
        this.state.wireCost
      )} cr / ${fmtInteger.format(this.state.wirePerPurchase)} wire</li>`,
      `<li><strong>Manual Efficiency:</strong> ${fmtInteger.format(
        this.state.manualEfficiency
      )} clip(s) per command</li>`,
      `<li><strong>Trust:</strong> ${fmtInteger.format(this.state.trust)}</li>`,
    ].join("");

    if (markup === this.lastAutomationMarkup) {
      return;
    }
    this.lastAutomationMarkup = markup;
    automationEl.innerHTML = markup;
  }

  renderQuickActions() {
    const markup = ACTION_DEFS.filter((def) => def.unlock(this.state))
      .map((def) => {
        const disabled = !this.buttonsEnabled || def.disabled(this);
        return `<button class="action-btn" data-command="${
          def.command
        }" ${disabled ? "disabled" : ""}>${def.label}</button>`;
      })
      .join("");

    if (markup === this.lastQuickActionsMarkup) {
      const buttons = quickActionsEl.querySelectorAll(".action-btn");
      buttons.forEach((btn) => {
        const command = btn.getAttribute("data-command");
        const def = ACTION_DEFS.find((action) => action.command === command);
        if (def) {
          btn.disabled = !this.buttonsEnabled || def.disabled(this);
        }
      });
      return;
    }

    this.lastQuickActionsMarkup = markup;
    quickActionsEl.innerHTML = markup;
    this.attachActionListeners();
  }

  attachActionListeners() {
    quickActionsEl.querySelectorAll(".action-btn").forEach((button) => {
      button.addEventListener("click", () => {
        if (button.disabled || !this.buttonsEnabled) {
          return;
        }
        const command = button.getAttribute("data-command");
        if (!command) {
          return;
        }
        this.executeCommand(command);
      });
    });
  }

  navigateHistory(direction) {
    if (!this.history.length) {
      return "";
    }

    if (direction === "older") {
      this.historyIndex = Math.min(
        this.historyIndex + 1,
        this.history.length - 1
      );
    } else if (direction === "newer") {
      this.historyIndex = Math.max(this.historyIndex - 1, -1);
    }

    if (this.historyIndex === -1) {
      return "";
    }

    return this.history[this.historyIndex];
  }

  updatePinnedState() {
    const distanceFromBottom =
      logEl.scrollHeight - logEl.clientHeight - logEl.scrollTop;
    this.isPinnedToBottom = distanceFromBottom <= 6;
  }

  getCommandSuggestions(prefix) {
    const needle = prefix.toLowerCase();
    if (!needle) {
      return [...COMMAND_SUGGESTIONS];
    }
    return COMMAND_SUGGESTIONS.filter((candidate) =>
      candidate.startsWith(needle)
    );
  }

  longestCommonPrefix(candidates) {
    if (!candidates.length) {
      return "";
    }
    let prefix = candidates[0];
    for (let i = 1; i < candidates.length; i++) {
      while (!candidates[i].startsWith(prefix) && prefix.length > 0) {
        prefix = prefix.slice(0, -1);
      }
      if (!prefix) {
        break;
      }
    }
    return prefix;
  }

  autocomplete(raw) {
    const trimmed = raw.trim();
    const hasTrailingSpace = raw.endsWith(" ") && trimmed.length > 0;
    const prefix = hasTrailingSpace ? `${trimmed} ` : trimmed;
    const suggestions = this.getCommandSuggestions(prefix);

    if (!prefix) {
      if (!suggestions.length) {
        return raw;
      }
      const suggestion = suggestions[0];
      return suggestion.endsWith(" ") ? suggestion : `${suggestion} `;
    }

    if (!suggestions.length) {
      return raw;
    }

    if (suggestions.length === 1) {
      const suggestion = suggestions[0];
      return suggestion.endsWith(" ") ? suggestion : `${suggestion} `;
    }

    if (hasTrailingSpace && suggestions.length > 1) {
      this.log("SYSTEM", `Options: ${suggestions.join(", ")}`);
      return raw;
    }

    const lcp = this.longestCommonPrefix(suggestions);
    if (lcp.length > prefix.length) {
      if (suggestions.length > 1) {
        const lastSpace = lcp.lastIndexOf(" ");
        if (lastSpace >= 0 && lastSpace < lcp.length - 1) {
          return lcp.slice(0, lastSpace + 1);
        }
      }
      return lcp;
    }

    this.log("SYSTEM", `Options: ${suggestions.join(", ")}`);
    return raw;
  }

  handleButtonsCommand(arg) {
    const normalized = (arg || "").toLowerCase();
    if (normalized === "on" || normalized === "enable") {
      this.setButtonsEnabled(true);
    } else if (normalized === "off" || normalized === "disable") {
      this.setButtonsEnabled(false);
    } else {
      this.log(
        "SYSTEM",
        "Usage: buttons <on|off>. Accepts 'on' or 'off'.",
        "warning"
      );
    }
  }

  setButtonsEnabled(value) {
    if (this.buttonsEnabled === value) {
      this.log(
        "SYSTEM",
        `Quick actions already ${value ? "enabled" : "disabled"}.`,
        "warning"
      );
      return;
    }
    this.buttonsEnabled = value;
    this.renderQuickActions();
    this.log(
      "SYSTEM",
      `Quick action buttons ${value ? "enabled" : "disabled"}.`,
      value ? "success" : ""
    );
  }
}

const game = new PaperclipCommand();
game.start();
window.paperclipCommand = game;

commandInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    const value = commandInput.value;
    commandInput.value = "";
    game.executeCommand(value);
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    commandInput.value = game.navigateHistory("older");
  } else if (event.key === "ArrowDown") {
    event.preventDefault();
    commandInput.value = game.navigateHistory("newer");
  } else if (event.key === "Tab") {
    if (
      commandInput.selectionStart === commandInput.selectionEnd &&
      commandInput.selectionStart === commandInput.value.length
    ) {
      event.preventDefault();
      const completion = game.autocomplete(commandInput.value);
      if (completion !== undefined && completion !== null) {
        commandInput.value = completion;
        commandInput.setSelectionRange(
          commandInput.value.length,
          commandInput.value.length
        );
      }
    }
  }
});
