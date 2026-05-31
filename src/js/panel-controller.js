import { ConnectivityError, IP_VALIDATION_ERROR_MAP, NetworkUtils, ipToString, maskToString, validateIPv4, validateMask, normalizeIPv4, normalizeMask, normalizeIPv4Value, maskPrefixLength, parseIpSlash } from "./network-utils.js";

const LINK_SPEEDS = {
  "ADSL": "20 Mbps",
  "Ethernet": "10 Mbps",
  "Bluetooth": "50 Mbps",
  "Satellite": "1 Gbps",
  "Fast Ethernet": "10 Gbps",
  "5G": "20 Gbps",
  "Fibre optique": "100 Gbps"
};

/**
 * Formate une IP et un masque en notation IP/Prefix ou IP seule si c'est un hôte (/32).
 */
function formatIpMask(ip, mask) {
  if (ip === null || ip === undefined) return "";
  const ipStr = ipToString(ip);
  // Si le masque est plein (255.255.255.255), on n'affiche que l'IP (hôte unique)
  if (mask === null || mask === 0xFFFFFFFF) return ipStr;
  // Sinon on affiche le préfixe CIDR
  return `${ipStr}/${maskPrefixLength(mask)}`;
}

function appendConsoleLine(container, text) {
  const line = document.createElement("div");
  line.textContent = text;
  container.appendChild(line);
  container.scrollTop = container.scrollHeight;
}

function formatConsoleEvent(event) {
  if (event.type === "trace") {
    return `[${event.layer}] ${event.actor}: ${event.message}`;
  }

  if (event.type === "info") {
    return event.message;
  }

  if (event.type === "icmp-request") {
    return `ICMP echo request ${ipToString(event.srcIP)} -> ${ipToString(event.destIP)}`;
  }

  if (event.type === "icmp-reply") {
    return `ICMP echo reply ${ipToString(event.srcIP)} -> ${ipToString(event.destIP)}`;
  }

  if (event.type === "arp-resolution") {
    return `Resolution ARP de ${ipToString(event.targetIP)}`;
  }

  if (event.type === "router-forward") {
    return `Transfert via le routeur ${event.routerName}`;
  }

  if (event.type === "path") {
    return `Chemin: ${event.deviceName.join(" -> ")}`;
  }

      if (event.type === "error" || event.type === "flag-error") {
    switch (event.code) {
      // Erreurs de validation IP/Masque (codes de ConnectivityError)
      case ConnectivityError.INVALID_IP:
        return `Adresse IP '${event.input}' est invalide ou mal formée.`;
      case ConnectivityError.INVALID_MASK:
        return `Masque réseau '${event.input}' est invalide ou mal formé.`;
      case ConnectivityError.INVALID_GATEWAY:
        return `Passerelle '${event.input}' est invalide ou mal formée.`;
      case ConnectivityError.NETWORK_ADDRESS_USED:
        return `L'adresse IP '${event.input}' est une adresse réseau et ne peut être attribuée.`;
      case ConnectivityError.BROADCAST_ADDRESS_USED:
        return `L'adresse IP '${event.input}' est une adresse de broadcast et ne peut être attribuée.`;
      case ConnectivityError.LOOPBACK_ADDRESS_USED:
        return `L'adresse IP '${event.input}' est une adresse de bouclage (127.x.x.x) et ne peut être attribuée.`;
      case ConnectivityError.LINK_LOCAL_ADDRESS_USED:
        return `L'adresse IP '${event.input}' est une adresse link-local (169.254.x.x) et ne peut être attribuée.`;
      case ConnectivityError.MULTICAST_ADDRESS_USED:
        return `L'adresse IP '${event.input}' est une adresse multicast (224.x.x.x - 239.x.x.x) et ne peut être attribuée.`;
      case ConnectivityError.INVALID_IP_NORMALIZATION:
        return `L'adresse IP '${event.input}' est valide mais ne peut être normalisée.`;
      case ConnectivityError.NAT_CONFLICT:
        return `Erreur de configuration NAT : ${event.message}`;

      // Erreurs de configuration (codes de ConnectivityError)
      case ConnectivityError.NO_GATEWAY:
        return `Erreur : Destination hors du réseau local et aucune passerelle configurée.`;
      case ConnectivityError.NO_LINK:
        return `L'interface n'est pas reliée à un autre équipement.`;
      case ConnectivityError.INTERFACE_DOWN:
        return `L'interface est inactive.`;
      case ConnectivityError.DEVICE_OFFLINE:
        return `L'équipement est hors ligne.`;
      case ConnectivityError.SWITCH_PORT_DISCONNECTED:
        return `Le port du switch est déconnecté.`;
      case ConnectivityError.ROUTER_INTERFACE_MISSING:
        return `L'interface du routeur est manquante.`;
      case ConnectivityError.ROUTER_INTERFACE_MISCONFIGURED:
        return `L'interface du routeur est mal configurée.`;

      // Erreurs de ping/simulation (codes de l'engine ou de ConnectivityError)
      case "usage-ping":
        return "Usage: ping <adresse-ip>";
      case "unknown-command":
        return `Commande inconnue: ${event.command}`;
      case "host-only":
        return "Le ping est disponible uniquement depuis un hôte.";
      case "invalid-ttl":
        return "TTL invalide. Utilisez une valeur comprise entre 1 et 255.";
      case "source-config-incomplète":
        return "Configuration IP source incomplète.";
      case "target-not-found":
        return `Adresse IP '${ipToString(event.targetIP)}' introuvable.`;
      case "same-subnet-no-layer2-path":
        return "La cible est dans le meme sous-reseau, mais aucun chemin de niveau 2 n'est disponible.";
      case "gateway-not-found":
        return `La passerelle ${ipToString(event.gatewayIP)} est introuvable sur la topologie.`;
      case "gateway-not-router":
        return `La passerelle ${ipToString(event.gatewayIP)} n'appartient pas a un routeur.`;
      case "gateway-not-local":
        return "La passerelle n'est pas dans le meme sous-réseau que la source.";
      case ConnectivityError.GATEWAY_UNREACHABLE:
        return `Impossible d'atteindre la passerelle ${ipToString(event.gatewayIP)} au niveau 2.`;
      case "route-not-found":
        return `Le routeur ${event.routerName} n'a pas de route vers ${ipToString(event.targetIP)}.`;
      case ConnectivityError.NO_ROUTE_TO_HOST:
        return `Aucune route vers l'hôte ${ipToString(event.targetIP)}.`;
      case ConnectivityError.DESTINATION_UNREACHABLE:
        return `La destination ${ipToString(event.targetIP)} est injoignable.`;
      case ConnectivityError.TTL_EXPIRED:
        return `TTL expiré avant d'atteindre ${ipToString(event.targetIP)}.`;
      case "ping-timeout":
        return `Aucune réponse de ${ipToString(event.targetIP)}.`;
      case "no-arp-table":
        return "Cette machine n'expose pas de table ARP.";
      case "no-mac-table":
        return "Cet equipement n'expose pas de table MAC.";
      case "no-routing-table":
        return "Cet équipement n'expose pas de table de routage.";
      case "router-source-missing":
        return event.message ?? "Adresse source routeur manquante.";
      case "simulation-limit":
        return "Limite de simulation atteinte. Vérifiez la présence d'une boucle de niveau 2.";

      default: // Fallback pour les codes non reconnus
        if (event.message) { // Si un message générique est fourni, l'utiliser
          return event.message;
        }
        return `Erreur de simulation inconnue (code: ${event.code}).`;
    }
  }

      if (event.type === "flag-found") return `Flag trouvé : ${event.flag}`;

  return "Evénement de simulation inconnu.";
}

function formatTimelineStep(step) {
  const event = step?.event;
  if (!event) {
    return "Etape inconnue.";
  }

  if (event.type === "initial-state") {
    return `Etat initial avant '${event.command}'.`;
  }

  return formatConsoleEvent(event);
}

function commitIPv4(rawValue, setter, device) {
  const trimmed = rawValue.trim();
  if (trimmed === "") {
    setter(null);
    return { success: true };
  }

  const validationResult = validateIPv4(trimmed);
  if (!validationResult.valid) {
    const mappedCode = IP_VALIDATION_ERROR_MAP[validationResult.code] || ConnectivityError.INVALID_IP;
    return { success: false, code: mappedCode, input: trimmed, device: device.name, layer: 3 };
  }

  // If validation passes, try to normalize it to an integer
  const normalized = normalizeIPv4(trimmed);
  if (normalized === null) {
    // This case should ideally not be reached if validateIPv4 is comprehensive,
    // but it's a safeguard for any edge cases in normalizeIPv4.
    return { success: false, code: ConnectivityError.INVALID_IP_NORMALIZATION, input: trimmed, device: device.name, layer: 3 };
  }

  setter(normalized);
  return { success: true };
}

function commitMask(rawValue, setter, device) {
  const trimmed = rawValue.trim();
  if (trimmed === "") {
    setter(null);
    return { success: true };
  }

  const validationResult = validateMask(trimmed);
  if (!validationResult.valid) {
    return { success: false, code: validationResult.code, input: trimmed, device: device.name, layer: 3 };
  }

  const normalized = normalizeMask(trimmed); // normalizeMask still returns null on failure
  if (normalized === null) { // This should not happen if validateMask passed, but for safety
    return { success: false, code: ConnectivityError.INVALID_MASK, input: trimmed, device: device.name, layer: 3 };
  }

  setter(normalized);
  return { success: true };
}

function createLabeledInput(type, value, labelText, placeholder = "", editable = true, oninput = null) {
  const wrapper = document.createElement("div");

  const label = document.createElement("div");
  label.className = "label";
  label.textContent = labelText;
  wrapper.appendChild(label);

  const input = document.createElement("input");
  input.type = type;
  input.value = value ?? "";
  input.placeholder = placeholder;
  input.disabled = !editable;

  if (oninput) {
    input.oninput = oninput;
  }

  wrapper.appendChild(input);
  return wrapper;
}

/**
 * Système générique pour gérer les fenêtres modales / contextuelles.
 * @param {HTMLElement} overlay - L'élément de fond (blur/overlay) qui contient la fenêtre.
 * @param {HTMLElement} trigger - Le bouton qui ouvre la fenêtre.
 * @param {boolean} fullscreen - Si true, ajoute la classe 'fullscreen' à l'overlay.
 */
export function setupModalPanel(overlay, trigger, fullscreen) {

  if (fullscreen===true) {
    overlay.classList.add("fullscreen");
  }

  const open = () => overlay.classList.remove("hidden");
  const close = () => overlay.classList.add("hidden");

  if (trigger) {
    trigger.addEventListener("click", open);
  }

  const closeButtons = overlay.querySelectorAll(".close-btn"); // Sélectionne uniquement les boutons de fermeture à l'intérieur de cet overlay spécifique
  closeButtons.forEach(btn => {
    if (btn) btn.addEventListener("click", close);
  });

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !overlay.classList.contains("hidden")) {
      close();
    }
  });

  return { open, close };
}

export function renderScenarioIntro(consignePanel, scenario) {
  
  consignePanel.querySelector("#titreScenario").textContent =  `🎯   ${scenario.code} — ${scenario.title}`;

  consignePanel.querySelector("#objectifScenario").textContent = scenario.objectif;
  
  const hintsScenario = consignePanel.querySelector("#hintsScenario");
  hintsScenario.innerHTML = "";
  if (scenario.hints.length > 0) {
    const hintsTitle = document.createElement("strong");
    hintsTitle.textContent = "Pistes";
    hintsScenario.appendChild(hintsTitle);

    scenario.hints.forEach((hint) => {
      const hintItem = document.createElement("div");
      hintItem.textContent = "• " + hint;
      hintsScenario.appendChild(hintItem);
    });
  }
}

function buildDeviceTitle(device) {
  const labels = {
    pc: "PC",
    server: "SERVEUR",
    switch: "SWITCH",
    router: "ROUTEUR",
  };

  return `${labels[device.type] ?? "APPAREIL"} - ${device.name}`;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function describePayload(payload) {
  if (!payload) {
    return null;
  }

  if (payload.kind === "arp") {
    return `ARP ${payload.op}: ${payload.srcIP} (${payload.srcMAC}) -> ${payload.targetIP}`;
  }

  if (payload.kind === "ipv4") {
    const suffix = payload.content?.kind === "icmp" ? ` (${payload.content.type})` : "";
    return `${payload.protocol} ${payload.srcIP} -> ${payload.destIP} TTL=${payload.ttl}${suffix}`;
  }

  if (payload.kind === "icmp") {
    return `ICMP ${payload.type}`;
  }

  if (payload.kind === "tcp") {
    return `TCP ${payload.srcPort} -> ${payload.destPort}`;
  }

  if (payload.kind === "udp") {
    return `UDP ${payload.srcPort} -> ${payload.destPort}`;
  }

  return payload.value ?? null;
}

function buildFocusLines(focus) {
  if (!focus) {
    return [];
  }

  if (focus.type === "frame-transmission") {
    const lines = [];
    if (focus.from && focus.to) {
      lines.push(`Lien actif: ${focus.from.deviceName}.${focus.from.name} -> ${focus.to.deviceName}.${focus.to.name}`);
    }
    if (focus.frame) {
      lines.push(`Trame Ethernet: ${focus.frame.srcMac} -> ${focus.frame.destMac}`);
      const payload = describePayload(focus.frame.payload);
      if (payload) {
        lines.push(`Charge utile: ${payload}`);
      }
    }
    return lines;
  }

  if (focus.type === "packet") {
    const lines = [];
    if (focus.device) {
      lines.push(`Noeud: ${focus.device.name}`);
    }
    const payload = describePayload(focus.packet);
    if (payload) {
      lines.push(`Paquet: ${payload}`);
    }
    if (focus.inInterface) {
      lines.push(`Interface entree: ${focus.inInterface.deviceName}.${focus.inInterface.name}`);
    }
    if (focus.outInterface) {
      lines.push(`Interface sortie: ${focus.outInterface.deviceName}.${focus.outInterface.name}`);
    }
    return lines;
  }

  if (focus.type === "arp") {
    const lines = [];
    if (focus.device) {
      lines.push(`Noeud: ${focus.device.name}`);
    }
    const payload = describePayload(focus.arp);
    if (payload) {
      lines.push(`Echange ARP: ${payload}`);
    }
    if (focus.inInterface) {
      lines.push(`Interface entree: ${focus.inInterface.deviceName}.${focus.inInterface.name}`);
    }
    if (focus.outInterface) {
      lines.push(`Interface sortie: ${focus.outInterface.deviceName}.${focus.outInterface.name}`);
    }
    return lines;
  }

  return [];
}

function createTableSection(title, headers, rows) {
  const section = document.createElement("div");
  section.className = "tableSection";

  const heading = document.createElement("div");
  heading.className = "tableSectionTitle";
  heading.textContent = title;
  section.appendChild(heading);

  if (rows.length === 0) {
    const empty = document.createElement("div");
    empty.className = "tableEmpty";
    empty.textContent = "Aucune entrée.";
    section.appendChild(empty);
    return section;
  }

  const table = document.createElement("table");
  const thead = document.createElement("thead");
  const headerRow = document.createElement("tr");
  headers.forEach((header) => {
    const th = document.createElement("th");
    th.textContent = header;
    headerRow.appendChild(th);
  });
  thead.appendChild(headerRow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  rows.forEach((row) => {
    const tr = document.createElement("tr");
    row.forEach((cell) => {
      const td = document.createElement("td");
      td.textContent = cell;
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);

  section.appendChild(table);
  return section;
}

export function createPanelController({ scenario, network, canvasView, engine, eventBus }) {
  const consigneBtn = document.getElementById("consigneBtn");
  const consigneBlur = document.getElementById("consigneBlur");
  const consignePanel = document.getElementById("consignePanel");
  const startChallengeBtn = document.getElementById("startChallengeBtn");
  const modeToggleBtn = document.getElementById("modeToggleBtn");
  const deviceInfos = document.getElementById("deviceInfos");
  const consoleContainer = document.getElementById("console");
  const consoleInput = document.getElementById("consoleInput");
  const consoleOutput = document.getElementById("consoleOutput");
  const titleElement = document.getElementById("deviceName");
  const linkButton = document.getElementById("linkBtn");
  const simulationStatus = document.getElementById("simulationStatus");
  const simulationCurrentStep = document.getElementById("simulationCurrentStep");
  const simulationTimeline = document.getElementById("simulationTimeline");
  const simulationBodyRight = document.getElementById("simulationBodyRight");
  const devicesInteractionLeft = document.getElementById("devicesInteractionLeft");
  const routingTableEditor = document.getElementById("routingTableEditor");
  const routingTableEditorTitle = document.getElementById("routingTableEditorTitle");
  const routingTableEditorMessage = document.getElementById("routingTableEditorMessage");
  const routingTableEditorBody = document.getElementById("routingTableEditorBody");
  const saveRoutingTableBtn = document.getElementById("saveRoutingTableBtn");
  const cancelRoutingTableBtn = document.getElementById("cancelRoutingTableBtn");
  const addRoutingRowBtn = document.getElementById("addRoutingRowBtn");
  const firewallEditor = document.getElementById("firewallEditor");
  const firewallAccessRulesBody = document.getElementById("firewallAccessRulesBody");
  const firewallNatRulesBody = document.getElementById("firewallNatRulesBody");
  const saveFirewallBtn = document.getElementById("saveFirewallBtn");
  const cancelFirewallBtn = document.getElementById("cancelFirewallBtn");
  const addAccessRuleBtn = document.getElementById("addAccessRuleBtn");
  const addNatRuleBtn = document.getElementById("addNatRuleBtn");

  const simAutoBtn = document.getElementById("simAutoBtn");
  const simPauseBtn = document.getElementById("simPauseBtn");
  const simSpeedRange = document.getElementById("simSpeedRange");
  const simStepBtn = document.getElementById("simStepBtn");
  const simPrevBtn = document.getElementById("simPrevBtn");
  const simNextBtn = document.getElementById("simNextBtn");
  const simResetBtn = document.getElementById("simResetBtn");
  
  let uiMode = "config"; // "config" | "simulation"
  
  const simulationState = {
    mode: "auto",
    result: null,
    currentStepIndex: 0,
    autoPlayInterval: 5000,
  };

  let routingTableUpdateTimer = null;
  let autoPlayTimer = null;
  let currentEditingRouter = null; // Référence pour nettoyer le flag de pause
  let activeConsoleDeviceId = null; // ID de l'équipement actuellement piloté par la console

  function stopAutoPlay() {
    if (autoPlayTimer) {
      clearInterval(autoPlayTimer);
      autoPlayTimer = null;
    }
  }

  function startAutoPlay() {
    stopAutoPlay();
    autoPlayTimer = setInterval(() => {
      const stepCount = getStepCount();
      if (simulationState.result && simulationState.currentStepIndex < stepCount - 1) {
        simulationState.currentStepIndex++;
        renderSimulation();
      } else {
        stopAutoPlay();
        renderSimulation();
      }
    }, simulationState.autoPlayInterval);
  }

  function setUIMode(mode) {
    uiMode = mode;

    const botPanel = document.getElementById("botPanel");
    botPanel.className = mode;

    if (mode === "simulation") {
      modeToggleBtn.textContent = "Mode Configuration";
      simulationState.currentStepIndex = 0;
      if (simulationState.mode === "auto") startAutoPlay();
      renderSimulation();
    } else {
      modeToggleBtn.textContent = "Mode Simulation";
      stopAutoPlay();
    }
  }
  modeToggleBtn.addEventListener("click", () => {
    if (uiMode === "config") {
      setUIMode("simulation");
    } else {
      setUIMode("config");
    }
  });

  function getStepCount() {
    return simulationState.result?.timeline?.length ?? 0;
  }

  function getDisplayedStep() {
    if (!simulationState.result || getStepCount() === 0) {
      return null;
    }

    return simulationState.result.timeline[simulationState.currentStepIndex] ?? null;
  }

  function getDisplayedSnapshot() {
    return getDisplayedStep()?.snapshot ?? engine.getNetworkSnapshot();
  }

  function clearSimulationResult() {
    simulationState.result = null;
    simulationState.currentStepIndex = 0;
    canvasView.setSimulationFocus(null);
    renderSimulation();
  }

  function resetSimulationRuntime() {
    engine.resetLearningState();
    clearSimulationResult();
  }

  function setSimulationMode(mode) {
    simulationState.mode = mode;

    if (!simulationState.result) {
      renderSimulation();
      return;
    }

    if (mode === "auto") {
      if (simulationState.currentStepIndex >= getStepCount() - 1) {
        simulationState.currentStepIndex = 0;
      }
      startAutoPlay();
    } else {
      stopAutoPlay();
    }

    renderSimulation();
  }

  function jumpToStep(nextIndex) {
    if (!simulationState.result || getStepCount() === 0) {
      return;
    }

    stopAutoPlay();
    simulationState.mode = "step";
    simulationState.currentStepIndex = clamp(nextIndex, 0, getStepCount() - 1);
    renderSimulation();
  }

  function setSimulationResult(result) {
    simulationState.result = result;
    simulationState.currentStepIndex = simulationState.mode === "step"
      ? 0
      : Math.max(0, (result.timeline?.length ?? 1) - 1);
    renderSimulation();
  }

  function renderSimulationStatusLine() {
    const stepCount = getStepCount();
    if (!simulationState.result || stepCount === 0) {
      simulationStatus.textContent = "Aucune simulation lancée. Utilisez des commandes console pour alimenter cette vue.";
      return;
    }

    const command = simulationState.result.timeline[0]?.event?.command ?? "commande";
    const verdict = simulationState.result.ok ? "succes" : "echec";
    simulationStatus.textContent = `Commande: ${command} | mode ${simulationState.mode} | resultat ${verdict} | etape ${simulationState.currentStepIndex + 1}/${stepCount}`;
  }

  function renderCurrentStep() {
    simulationCurrentStep.innerHTML = "";

    const step = getDisplayedStep();
    if (!step) {
      const empty = document.createElement("div");
      empty.className = "muted";
      empty.textContent = "La lecture pas-à-pas apparaîtra ici.";
      simulationCurrentStep.appendChild(empty);
      return;
    }

    const titleRow = document.createElement("div");
    titleRow.className = "currentStepTitle";

    const badge = document.createElement("span");
    badge.className = "stepBadge";
    badge.textContent = step.event.type === "trace" ? step.event.layer : `#${step.index}`;
    titleRow.appendChild(badge);

    const title = document.createElement("strong");
    title.textContent = formatTimelineStep(step);
    titleRow.appendChild(title);
    simulationCurrentStep.appendChild(titleRow);

    const lines = buildFocusLines(step.snapshot?.focus);
    if (step.snapshot?.visited?.length > 0) {
      lines.push(`Parcours observe: ${step.snapshot.visited.join(" -> ")}`);
    }
    if ((step.snapshot?.queueLength ?? 0) > 0) {
      lines.push(`File d'attente restante: ${step.snapshot.queueLength}`);
    }

    if (lines.length === 0) {
      const muted = document.createElement("div");
      muted.className = "muted";
      muted.textContent = "Pas de details de trame ou de paquet pour cette etape.";
      simulationCurrentStep.appendChild(muted);
      return;
    }

    lines.forEach((line) => {
      const lineElement = document.createElement("div");
      lineElement.className = "detailLine";
      lineElement.textContent = line;
      simulationCurrentStep.appendChild(lineElement);
    });
  }

  function renderTimeline() {
    simulationTimeline.innerHTML = "";

    const stepCount = getStepCount();
    if (!simulationState.result || stepCount === 0) {
      const empty = document.createElement("div");
      empty.className = "muted";
      empty.textContent = "La trace des trames et paquets sera listée ici.";
      simulationTimeline.appendChild(empty);
      return;
    }

    simulationState.result.timeline.forEach((step, index) => {
      const item = document.createElement("div");
      item.className = "stepItem";
      if (index === simulationState.currentStepIndex) {
        item.classList.add("active");
      }

      item.textContent = `${index}. ${formatTimelineStep(step)}`;
      item.addEventListener("click", () => jumpToStep(index));
      simulationTimeline.appendChild(item);
    });
  }

  function renderTables() {
    simulationBodyRight.innerHTML = "";

    const snapshot = getDisplayedSnapshot();
    const devices = snapshot.devices.filter((device) => (
      device.type === "pc"
      || device.type === "server"
      || device.type === "switch"
      || device.type === "router"
    ));

    if (devices.length === 0) {
      const empty = document.createElement("div");
      empty.className = "muted";
      empty.textContent = "Aucun equipement a afficher.";
      simulationBodyRight.appendChild(empty);
      return;
    }

    devices.forEach((device) => {
      const card = document.createElement("div");
      card.className = "tableCard";

      const heading = document.createElement("div");
      heading.className = "tableCardTitle";
      heading.textContent = `${buildDeviceTitle(device)}`;
      card.appendChild(heading);

      const ifaceSummary = document.createElement("div");
      ifaceSummary.className = "deviceInterfaces";
      device.interfaces.forEach((iface) => {
        const line = document.createElement("div");
        line.className = "deviceInterfaceLine";
        const address = iface.ip ? `${iface.ip} / ${iface.mask ?? "-"}` : "non configurée";
        line.textContent = `${iface.name}: ${address}`;
        ifaceSummary.appendChild(line);
      });
      card.appendChild(ifaceSummary);

      if (device.type === "pc" || device.type === "server" || device.type === "router") {
        card.appendChild(createTableSection(
          "Table ARP",
          ["IP", "MAC", "Sortie"],
          device.arpTable.map((entry) => [entry.ip, entry.mac, entry.interfaceName]),
        ));
      }

      if (device.type === "switch") {
        card.appendChild(createTableSection(
          "Table MAC",
          ["MAC", "Port"],
          device.macTable.map((entry) => [entry.mac, entry.interfaceName]),
        ));
      }

      if (device.type === "router") {
        const kindLabels = { connected: "C", static: "S", rip: "R", ospf: "O" };
        card.appendChild(createTableSection(
          `Table de routage - ${device.name}`,
          ["Type", "Reseau", "Next-hop", "Sortie", "Cout"],
          device.routingTable.map((route) => [
            kindLabels[route.kind] || "?",
            `${ipToString(route.networkIp)}/${route.prefix ?? maskPrefixLength(route.networkMask)}`,
            route.nextHop ? ipToString(route.nextHop) : "-",
            typeof route.outInterface === 'string' ? route.outInterface : (route.outInterface?.name ?? "-"),
            (route.cost === null || route.cost === undefined) ? "" : String(route.cost),
          ]),
        ));
      }

      if (device.type === "router" && device.firewall) {
        const policyLabel = device.firewall.defaultPolicy === 'allow' ? "Autoriser (Default Allow)" : "Interdire (Default Deny)";
        card.appendChild(createTableSection(
          `Règles d'accès Firewall (Posture : ${policyLabel})`,
          ["Source IP/Mask", "Dest. IP/Mask", "Protocole", "Action"],
          device.firewall.accessRules.map((rule) => [
            rule.src_ip ? `${ipToString(rule.src_ip)}${rule.src_mask ? '/' + maskToString(rule.src_mask) : ''}` : "any",
            rule.dst_ip ? `${ipToString(rule.dst_ip)}${rule.dst_mask ? '/' + maskToString(rule.dst_mask) : ''}` : "any",
            rule.protocol,
            rule.action,
          ]),
        ));

        card.appendChild(createTableSection(
          "Règles NAT Firewall",
          ["IP/Mask Publique", "IP/Mask Privée"],
          device.firewall.natRules.map((rule) => [
            `${ipToString(rule.public_ip)}${rule.public_mask ? '/' + maskToString(rule.public_mask) : ''}`,
            `${ipToString(rule.private_ip)}${rule.private_mask ? '/' + maskToString(rule.private_mask) : ''}`,
          ]),
        ));
      }

      simulationBodyRight.appendChild(card);
    });
  }

  function renderSimulation() {
    renderSimulationStatusLine();
    renderCurrentStep();
    renderTimeline();
    renderTables();

    simAutoBtn.classList.toggle("active", simulationState.mode === "auto");
    simStepBtn.classList.toggle("active", simulationState.mode === "step");

    simPrevBtn.disabled = !simulationState.result || simulationState.currentStepIndex <= 0;
    simNextBtn.disabled = !simulationState.result || simulationState.currentStepIndex >= Math.max(0, getStepCount() - 1);

    canvasView.setSimulationFocus(getDisplayedStep()?.snapshot?.focus ?? null);
  }

  function resetPanel(preserveConsole = false) {
    if (currentEditingRouter) {
      currentEditingRouter.isEditingRoutingTable = false;
      currentEditingRouter = null;
    }

    if (routingTableUpdateTimer) {
      clearInterval(routingTableUpdateTimer);
      routingTableUpdateTimer = null;
    }

    // On vide les éditeurs mais on préserve la console si demandé (background updates)
    deviceInfos.innerHTML = "";
    if (!preserveConsole) {
      activeConsoleDeviceId = null;
      titleElement.textContent = "";
      consoleContainer.style.display = "none";
      consoleInput.value = "";
      consoleInput.onkeydown = null;
      consoleOutput.innerHTML = "";
    }

    linkButton.style.display = "none";
    linkButton.className = "";
    devicesInteractionLeft.classList.remove("hidden");
    routingTableEditor.classList.add("hidden");
    firewallEditor.classList.add("hidden"); // Hide firewall editor too
  }

  function refresh() {
    const target = canvasView.selectedNodes[canvasView.selectedNodes.length - 1];
    const selectedDeviceId = target ? target.deviceId : null;

    // Sécurité : Si l'utilisateur est en train d'éditer le Firewall ou les Routes,
    // on ignore le rafraîchissement global provoqué par les protocoles en arrière-plan.
    const isRoutingEditorActive = !routingTableEditor.classList.contains("hidden");
    const isFirewallEditorActive = !firewallEditor.classList.contains("hidden");
    const isConsoleActive = consoleContainer.style.display !== "none";

    if (isRoutingEditorActive || isFirewallEditorActive) return;

    // On préserve la console uniquement si on rafraîchit le MÊME équipement 
    // (cas des mises à jour RIP/OSPF en arrière-plan)
    const preserveConsole = isConsoleActive && (selectedDeviceId === activeConsoleDeviceId) && (selectedDeviceId !== null);

    resetPanel(preserveConsole); 

    // Cas spécifique : Sélection d'une liaison entre deux interfaces
    if (canvasView.selectedNodes.length === 2 && canvasView.selectedNodes.every(n => n.type === "iface")) {
      const [nodeA, nodeB] = canvasView.selectedNodes;
      const ifaceA = network.findDeviceById(nodeA.deviceId).interfaces[nodeA.index];
      const ifaceB = network.findDeviceById(nodeB.deviceId).interfaces[nodeB.index];
      const link = network.findLinkBetween(ifaceA, ifaceB);
      
      if (link) {
        renderLinkEditor(link);
        maybeRenderLinkButton();
        return;
      }
    }

    maybeRenderLinkButton();
    
    if (!target) {
      return;
    }
    if (target.type === "dev") {
      renderDeviceEditor(network.findDeviceById(target.deviceId));
      return;
    }

    renderInterfaceEditor(
      network.findDeviceById(target.deviceId),
      target.index,
    );
  }

  function renderLinkEditor(link) {
    titleElement.textContent = `LIAISON - ${link.type}`;
    titleElement.className = "secondary";

    const wrapper = document.createElement("div");
    wrapper.style.display = "flex";
    wrapper.style.flexDirection = "column";
    wrapper.style.gap = "8px";

    const label = document.createElement("b");
    label.textContent = "Type de média (coût OSPF) :";
    wrapper.appendChild(label);

    const select = document.createElement("select");
    select.style.padding = "6px";
    select.disabled =!link.editable;

    Object.entries(LINK_SPEEDS).forEach(([type, speed]) => {
      const opt = document.createElement("option");
      opt.value = type;
      opt.textContent = `${type} (${speed})`;
      opt.selected = link.type === type;
      select.appendChild(opt);
    });

    select.onchange = (e) => {
      link.type = e.target.value;
      resetSimulationRuntime();
      canvasView.draw();
      refresh();
    };

    wrapper.appendChild(select);
    deviceInfos.appendChild(wrapper);
  }

  function maybeRenderLinkButton() {
    if (
      canvasView.selectedNodes.length !== 2
      || !canvasView.selectedNodes.every((node) => node.type === "iface")
    ) {
      return;
    }

    const [nodeA, nodeB] = canvasView.selectedNodes;
    const deviceA = network.findDeviceById(nodeA.deviceId);
    const deviceB = network.findDeviceById(nodeB.deviceId);
    const interfaceA = deviceA.interfaces[nodeA.index];
    const interfaceB = deviceB.interfaces[nodeB.index];
    const existingLink = network.findLinkBetween(interfaceA, interfaceB);

    if (existingLink && interfaceA.linkable && interfaceB.linkable) {
      linkButton.style.display = "inline-block";
      linkButton.textContent = "Délier";
      linkButton.className = "danger";
      return;
    }

    const canCreateLink = !existingLink
      && !interfaceA.link
      && !interfaceB.link
      && interfaceA.linkable
      && interfaceB.linkable
      && deviceA !== deviceB;

    if (canCreateLink) {
      linkButton.style.display = "inline-block";
      linkButton.textContent = "Lier";
      linkButton.className = "";
    }
  }

  function renderDeviceEditor(device) {
    titleElement.textContent = buildDeviceTitle(device);
    titleElement.className = device.type;
    deviceInfos.appendChild(createLabeledInput(
      "text",
      device.name,
      "Nom de l'appareil",
      "Nom de l'appareil",
      device.editable,
      (event) => {
        device.name = event.target.value;
        clearSimulationResult();
        canvasView.draw();
      },
    ));

    if (["switch", "router"].includes(device.type)) {
      deviceInfos.appendChild(createLabeledInput(
        "number",
        device.interfaces.length,
        device.type === "switch" ? "Nombre de ports" : "Nombre d'interfaces",
        "",
        device.editable,
        (event) => {
          const nextValue = parseInt(event.target.value, 10);
          if (Number.isNaN(nextValue) || nextValue < 1) {
            return;
          }

          if (nextValue > device.interfaces.length) {
            for (let index = device.interfaces.length; index < nextValue; index += 1) {
              device.addInterface(
                device.type === "router" ? `eth${index}` : `p${index}`,
                null,
                null,
                1,
                device.editable
              );
            }
          } else if (nextValue < device.interfaces.length) {
            const keep = device.interfaces.slice(0, nextValue);
            const removed = device.interfaces.slice(nextValue);
            const hasLockedLink = removed.some((iface) => iface.link && (!iface.editable || !iface.link.otherSide(iface).editable));

            if (hasLockedLink) {
              event.target.value = String(device.interfaces.length);
              return;
            }

            removed.forEach((iface) => {
              if (iface.link && iface.editable && iface.link.otherSide(iface).editable) {
                network.removeLink(iface.link);
              }
            });

            device.interfaces = keep;
          }

          resetSimulationRuntime();
          canvasView.draw();
          refresh();
        },
      ));
    }
    if (["pc", "server", "router"].includes(device.type)) {
      device.interfaces.forEach((iface) => {
        const canEditInterface = device.editable || iface.editable;
        const title = document.createElement("b");
        title.innerText = "Configuration de l'interface " + iface.name + " de cet appareil :";
        deviceInfos.appendChild(title);

        deviceInfos.appendChild(createLabeledInput(
          "text",
          ipToString(iface.ip),
          "Adresse IP",
          "Notation decimale pointée",
        iface.editable, // Use iface.editable directly for interface IP
          (event) => {
            const result = commitIPv4(event.target.value, (value) => iface.setIp(value), device);
            if (result.success) {
              resetSimulationRuntime();
              canvasView.draw();
              if (device.consoleAccessible && consoleContainer.style.display !== "none") {
                consoleOutput.innerHTML = ""; // Clear previous console errors
              }
            } else if (device.consoleAccessible) {
              consoleContainer.style.display = "flex"; // Ensure console is visible
              consoleOutput.innerHTML = "";
              appendConsoleLine(consoleOutput, `Erreur de configuration IP: ${formatConsoleEvent({ type: "error", code: result.code, input: result.input })}`);
            }
          },
        ));

        deviceInfos.appendChild(createLabeledInput(
          "text",
          maskToString(iface.mask),
          "Masque",
          "Notation CIDR ou decimale",
          !!iface.editable, // Force boolean for disabled attribute
          (event) => {
            const result = commitMask(event.target.value, (value) => iface.setMask(value), device);
            if (result.success) {
              resetSimulationRuntime();
              canvasView.draw();
              if (device.consoleAccessible && consoleContainer.style.display !== "none") {
                consoleOutput.innerHTML = ""; // Clear previous console errors
              }
            } else if (device.consoleAccessible) {
              consoleContainer.style.display = "flex"; // Ensure console is visible
              consoleOutput.innerHTML = "";
              appendConsoleLine(consoleOutput, `Erreur de configuration Masque: ${formatConsoleEvent({ type: "error", code: result.code, input: result.input })}`);
            }
          },
        ));
      });
    }

    if (device.type === "pc" || device.type === "server") {
      deviceInfos.appendChild(createLabeledInput(
        "text",
        ipToString(device.gateway),
        "Passerelle par défaut",
        "Notation decimale pointée",
        !!device.getInterface()?.editable, // Gateway editability depends on the interface's editability
        (event) => {
          const result = commitIPv4(event.target.value, (value) => device.setGateway(value), device);
          if (result.success) {
            resetSimulationRuntime();
            canvasView.draw();
            if (device.consoleAccessible && consoleContainer.style.display !== "none") {
              consoleOutput.innerHTML = ""; // Clear previous console errors
            }
          } else if (device.consoleAccessible) {
            consoleContainer.style.display = "flex"; // Ensure console is visible
            consoleOutput.innerHTML = "";
            appendConsoleLine(consoleOutput, `Erreur de configuration Passerelle: ${formatConsoleEvent({ type: "error", code: result.code, input: result.input })}`);
          }
        },
      ));
    }


    if (device.type === "router") {
      const protocolSection = document.createElement("div");
      protocolSection.className = "protocol-config";
      const label = document.createElement("b");
      label.textContent = "Protocoles de routage dynamique :";
      protocolSection.appendChild(label);
      const cbListContainer = document.createElement("div");
      cbListContainer.className = "checkbox-list";

      ["RIP", "OSPF"].forEach(proto => {
        const cbItemContainer = document.createElement("div");
        cbItemContainer.className = "checkbox-item";
        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.checked = device.enabledProtocols.includes(proto);
        cb.disabled = !device.routingProtocolEditable; // Respect de l'édition
        
        if (device.routingProtocolEditable) {
          cb.onchange = (e) => {
          const newList = e.target.checked 
            ? [...device.enabledProtocols, proto]
            : device.enabledProtocols.filter(p => p !== proto);
          device.setProtocols(newList);
        };
        }
        
        cbItemContainer.appendChild(cb);
        const p = cbItemContainer.appendChild(document.createElement("p"));
        p.innerText = proto;
        cbItemContainer.appendChild(p);
        cbListContainer.appendChild(cbItemContainer);
      });
      protocolSection.appendChild(cbListContainer);
      deviceInfos.appendChild(protocolSection);

      // Bouton pour configurer la table de routage
      const routeBtnContainer = document.createElement("div");
      routeBtnContainer.style.marginTop = "10px";
      const configRouteBtn = document.createElement("button");
      configRouteBtn.textContent  = device.routingTableEditable ? "Configurer la table de routage" : "Voir la table de routage";
      configRouteBtn.className = "btn secondary";
      routingTableEditorTitle.innerText = device.routingTableEditable ? "Configurer la table de routage" : `Table de routage de ${device.name}`;
      configRouteBtn.onclick = () => openRoutingTableEditor(device);
      routeBtnContainer.appendChild(configRouteBtn);
      deviceInfos.appendChild(routeBtnContainer);

      // Bouton pour configurer le firewall
      if (device.firewall) { // Only enable if firewall exists
        const firewallBtnContainer = document.createElement("div");
        firewallBtnContainer.style.marginTop = "10px";
        const configFirewallBtn = document.createElement("button");
        configFirewallBtn.textContent = device.firewall.editable ? "Configurer le firewall" : "Voir les règles du firewall";
        configFirewallBtn.className = "btn secondary";
        configFirewallBtn.onclick = () => openFirewallEditor(device);
        saveFirewallBtn.disabled = !device.firewall.editable;
        firewallBtnContainer.appendChild(configFirewallBtn);
        deviceInfos.appendChild(firewallBtnContainer);
      }
    }

    if (device.consoleAccessible) { // Console access is now configurable
      renderConsole(device);
    }
  }

  function openRoutingTableEditor(device) {
    devicesInteractionLeft.classList.add("hidden");
    routingTableEditor.classList.remove("hidden");
    saveRoutingTableBtn.disabled = !device.routingTableEditable;
    
    // Mise à jour immédiate à l'ouverture
    renderRoutingTableRows(device);

    if (device.routingTableEditable) {
      // Mode Édition : on met en pause les mises à jour automatiques pour ne pas écraser la saisie
      device.isEditingRoutingTable = true;
      currentEditingRouter = device;
      routingTableEditorMessage.innerHTML = "<b>Mode Édition</b> : La mise à jour automatique est en pause.";
      routingTableEditorMessage.style.color = "#f97316";
    } else {
      // Mode Consultation : rafraîchissement dynamique toutes les secondes
      routingTableEditorMessage.innerHTML = "<b>Mode Lecture seule</b> : Mise à jour dynamique active (patientez).";
      routingTableEditorMessage.style.color = "#22c55e";
      routingTableUpdateTimer = setInterval(() => renderRoutingTableRows(device), 1000);
    }
    routingTableEditorMessage.style.marginBottom = "10px";

    // Gestion du bouton d'ajout de ligne
    addRoutingRowBtn.classList.toggle("hidden", !device.routingTableEditable);
    addRoutingRowBtn.onclick = device.routingTableEditable ? () => {
      appendRoutingRow(device, { networkIp: "", networkMask: "", nextHop: "", outInterface: null, cost: "", kind: "static" }, -1, true);
    } : null;
    
    // Save button for routing table
    saveRoutingTableBtn.onclick = () => {
      saveRoutingTableData(device);
      device.isEditingRoutingTable = false;
      currentEditingRouter = null;
      if (routingTableUpdateTimer) clearInterval(routingTableUpdateTimer);
      routingTableEditor.classList.add("hidden");
      devicesInteractionLeft.classList.remove("hidden");
      refresh();
    };

    cancelRoutingTableBtn.onclick = () => {
      device.isEditingRoutingTable = false;
      currentEditingRouter = null;
      if (routingTableUpdateTimer) clearInterval(routingTableUpdateTimer);
      routingTableEditor.classList.add("hidden");
      devicesInteractionLeft.classList.remove("hidden");
      refresh();
    };
  }

  function openFirewallEditor(device) {
    devicesInteractionLeft.classList.add("hidden");
    firewallEditor.classList.remove("hidden");

    // Mise à jour dynamique des en-têtes pour l'approche "un seul champ" (IP/Masque)
    const aclHeader = firewallEditor.querySelector("table:first-of-type thead tr");
    if (aclHeader) {
      aclHeader.innerHTML = `
        <th title="Adresse IP source" class="help">Source IP</th>
        <th title="Masque de sous-réseau source" class="help">Masque Src</th>
        <th title="Adresse IP de destination" class="help">Dest. IP</th>
        <th title="Masque de sous-réseau destination" class="help">Masque Dst</th>
        <th title="Protocole" class="help">Protocoles</th>
        <th title="Action (allow ou deny)" class="help">Action</th>
        <th></th>
      `;
    }

    const natHeader = firewallEditor.querySelector("table:last-of-type thead tr");
    if (natHeader) {
      natHeader.innerHTML = `
        <th title="Adresse IP publique" class="help">IP Publique</th>
        <th title="Masque public" class="help">Masque Pub.</th>
        <th title="Adresse IP privée" class="help">IP Privée</th>
        <th title="Masque privé" class="help">Masque Priv.</th>
        <th></th>
      `;
    }

    renderFirewallRules(device);

    const policySelect = document.getElementById("firewallDefaultPolicy");
    if (policySelect) {
      policySelect.value = device.firewall.defaultPolicy;
      policySelect.disabled = !device.firewall.editable;
    }

    // Save button for firewall rules
    saveFirewallBtn.onclick = () => {
      saveFirewallData(device);
      refresh();
    };

    cancelFirewallBtn.onclick = () => {
      firewallEditor.classList.add("hidden");
      devicesInteractionLeft.classList.remove("hidden");
      refresh();
    };

    if (device.firewall.editable) {
      addAccessRuleBtn.onclick = () => {
        device.firewall.addAccessRule("", "", "", "", "", "deny"); // Add a default deny rule
        renderFirewallRules(device);
      };
      addNatRuleBtn.onclick = () => {
        device.firewall.addNatRule("", "", "", ""); // Add an empty NAT rule
        renderFirewallRules(device);
      };
    } else {
      addAccessRuleBtn.classList.add("hidden");
      addNatRuleBtn.classList.add("hidden");
    }
  }

  function renderFirewallRules(device) {
    firewallAccessRulesBody.innerHTML = "";
    firewallNatRulesBody.innerHTML = "";

    const isEditable = device.firewall.editable;

    device.firewall.accessRules.forEach((rule, index) => {
      firewallAccessRulesBody.appendChild(createFirewallAccessRuleRow(rule, index, device, isEditable));
    });
    if (isEditable && device.firewall.accessRules.length === 0) { // Always show one empty row if editable and no rules
      firewallAccessRulesBody.appendChild(createFirewallAccessRuleRow({}, -1, device, isEditable));
    }

    device.firewall.natRules.forEach((rule, index) => {
      firewallNatRulesBody.appendChild(createFirewallNatRuleRow(rule, index, device, isEditable));
    });
    if (isEditable && device.firewall.natRules.length === 0) { // Always show one empty row if editable and no rules
      firewallNatRulesBody.appendChild(createFirewallNatRuleRow({}, -1, device, isEditable));
    }

    addAccessRuleBtn.classList.toggle("hidden", !isEditable);
    addNatRuleBtn.classList.toggle("hidden", !isEditable);
  }

  function renderRoutingTableRows(device) {
    routingTableEditorBody.innerHTML = "";
    
    // SOURCE UNIQUE DE VERITE : On utilise toujours getRoutes() qui contient C, S, R et O
    const routes = device.getRoutes();

    routes.forEach((route, idx) => {
      appendRoutingRow(device, route, idx, false);
    });
  }

  function appendRoutingRow(device, route, idx, isNew = false) {
    const tr = document.createElement("tr");
    
    const createCellInput = (val, placeholder, isIp = true) => {
      const td = document.createElement("td");
      const input = document.createElement("input");
      input.type = "text";
      input.value = (isIp && typeof val === "number") ? ipToString(val) : (val !== null && val !== undefined ? val : "");
      input.placeholder = placeholder;
      // Seules les routes statiques sont modifiables
      input.disabled = !device.routingTableEditable || route.kind !== "static"; 
      input.style.width = "95%";
      input.style.minWidth = "0";
      td.appendChild(input);
      return { td, input };
    };

    const protoCell = document.createElement("td");
    protoCell.textContent = route.kind || "static";
    tr.appendChild(protoCell);

    const dest = createCellInput(route.networkIp, "Réseau");
    const mask = createCellInput(route.networkMask, "Masque");
    const hop = createCellInput(route.nextHop, "Next-hop");
    
    const ifaceTd = document.createElement("td");
    const ifaceSel = document.createElement("select");
    ifaceSel.disabled = !device.routingTableEditable || route.kind !== "static"; 
    ifaceSel.innerHTML = `<option value="">Auto</option>` + device.interfaces.map(i => `<option value="${i.name}" ${route.outInterface === i.name || route.outInterface?.name === i.name ? 'selected' : ''}>${i.name}</option>`).join("");
    ifaceTd.appendChild(ifaceSel);

    const cost = createCellInput(route.cost, "Coût", false);

    tr.append(dest.td, mask.td, hop.td, ifaceTd, cost.td);

    if (device.routingTableEditable && route.kind === "static") {
      const deleteTd = document.createElement("td");
      const deleteBtn = document.createElement("button");
      deleteBtn.className = "btn danger";
      deleteBtn.innerHTML = "🗑️";
      deleteBtn.style.padding = "2px 5px";
      deleteBtn.onclick = () => {
        if (!isNew) {
          device.routingTable.splice(idx, 1);
          renderRoutingTableRows(device);
          resetSimulationRuntime();
        } else {
          tr.remove(); // Supprime simplement la ligne du DOM si elle n'était pas enregistrée
        }
      };
      deleteTd.appendChild(deleteBtn);
      tr.appendChild(deleteTd);
    }
    routingTableEditorBody.appendChild(tr);
  }

  function saveRoutingTableData(device) {
    const newTable = [];
    const rows = routingTableEditorBody.querySelectorAll("tr");
    
    rows.forEach(row => {
      const protoCell = row.querySelector("td:first-child"); // Récupère la cellule du protocole
      const inputs = row.querySelectorAll("input");
      const select = row.querySelector("select");
      
      const destination = inputs[0].value.trim(); // Destination IP
      const mask = inputs[1].value.trim();
      if (destination && mask) {
        const nextHop = inputs[2].value.trim() || null;
        const outInterface = select.value || null;
        const costVal = inputs[3].value.trim();
        const cost = costVal === "" ? null : parseInt(costVal, 10);
        
        // Validation avant normalisation pour feedback utilisateur
        const vDest = validateIPv4(destination);
        const vMask = validateMask(mask);
        
        if (!vDest.valid) {
          alert(`Erreur réseau : ${destination} n'est pas une adresse IP valide.`);
          return;
        }
        if (!vMask.valid) {
          alert(`Erreur masque : ${mask} n'est pas un masque valide.`);
          return;
        }
        if (nextHop) {
          const vHop = validateIPv4(nextHop);
          if (!vHop.valid) {
            alert(`Erreur next-hop : ${nextHop} n'est pas une adresse IP valide.`);
            return;
          }
        }

        // On utilise la méthode du modèle pour valider/ajouter
        const networkInt = normalizeIPv4Value(destination);
        const maskInt = normalizeMask(mask);
        const nextHopInt = nextHop ? normalizeIPv4Value(nextHop) : null;

        if (networkInt !== null && maskInt !== null) {
          // Le type de route est récupéré de la cellule du protocole
          // Si c'est une nouvelle route ajoutée, elle est "static" par défaut
          const kind = protoCell ? protoCell.textContent.toLowerCase() : "static";
          // On ne permet pas d'éditer le kind des routes dynamiques via l'UI
          const finalKind = ["rip", "ospf", "connected"].includes(kind) && !row.dataset.isNew ? kind : "static";
          newTable.push({ networkIp: networkInt, networkMask: maskInt, nextHop: nextHopInt, outInterface: device.getInterfaceByName(outInterface), cost, kind: finalKind });
        }
      }
    });

    // On trie également la table de configuration pour la cohérence visuelle dans l'éditeur
    device.routingTable = newTable.sort((a, b) => 
      maskPrefixLength(b.networkMask) - maskPrefixLength(a.networkMask)
    );
    // On met à jour la table de routage du routeur avec les nouvelles routes statiques
    // Les routes dynamiques seront ré-apprises par les protocoles
    device.routingTable = device.routingTable.filter(r => 
      r.kind === "static" || (device.routingTableEditable && r.kind !== "static")
    );

    resetSimulationRuntime();
  }

  function createFirewallAccessRuleRow(rule, index, device, isEditable) {
    const tr = document.createElement("tr");
    const createInput = (val, placeholder) => {
      const td = document.createElement("td");
      const input = document.createElement("input");
      input.type = "text";
      input.value = val ? (typeof val === "number" ? ipToString(val) : val) : "";
      input.placeholder = placeholder;
      input.disabled = !isEditable;
      input.readOnly = !isEditable; // Pour les champs non éditables, on veut juste les voir
      input.style.width = "95%";
      td.appendChild(input);
      return { td, input };
    };

    const srcIp = createInput(ipToString(rule.src_ip), "any");
    const srcMask = createInput(maskToString(rule.src_mask), "any");
    const dstIp = createInput(ipToString(rule.dst_ip), "any");
    const dstMask = createInput(maskToString(rule.dst_mask), "any");
    const protocol = createInput(rule.protocol, "any (ICMP, TCP, UDP)");

    const actionTd = document.createElement("td");
    const actionSelect = document.createElement("select");
    actionSelect.disabled = !isEditable;
    actionSelect.readOnly = !isEditable;
    ["allow", "deny"].forEach(act => {
      const opt = document.createElement("option");
      opt.value = act;
      opt.textContent = act;
      opt.selected = rule.action === act;
      actionSelect.appendChild(opt);
    });
    actionTd.appendChild(actionSelect);

    tr.append(srcIp.td, srcMask.td, dstIp.td, dstMask.td, protocol.td, actionTd);

    if (isEditable) {
      const actionsTd = document.createElement("td");
      actionsTd.style.display = "flex";
      actionsTd.style.gap = "2px";

      // Bouton Monter
      const upBtn = document.createElement("button");
      upBtn.textContent = "↑";
      upBtn.className = "btn secondary";
      upBtn.style.padding = "2px 5px";
      upBtn.disabled = index <= 0;
      upBtn.onclick = () => {
        syncFirewallFromUI(device);
        const rules = device.firewall.accessRules;
        [rules[index], rules[index - 1]] = [rules[index - 1], rules[index]];
        renderFirewallRules(device);
      };

      // Bouton Descendre
      const downBtn = document.createElement("button");
      downBtn.textContent = "↓";
      downBtn.className = "btn secondary";
      downBtn.style.padding = "2px 5px";
      downBtn.disabled = index === -1 || index >= device.firewall.accessRules.length - 1;
      downBtn.onclick = () => {
        syncFirewallFromUI(device);
        const rules = device.firewall.accessRules;
        [rules[index], rules[index + 1]] = [rules[index + 1], rules[index]];
        renderFirewallRules(device);
      };

      const deleteBtn = document.createElement("button");
      deleteBtn.textContent = "🗑️";
      deleteBtn.className = "btn danger";
      deleteBtn.style.padding = "2px 5px";
      deleteBtn.onclick = () => {
        syncFirewallFromUI(device);
        device.firewall.accessRules.splice(index, 1);
        renderFirewallRules(device);
      };

      actionsTd.append(upBtn, downBtn, deleteBtn);
      tr.appendChild(actionsTd);
    }

    return tr;
  }

  function createFirewallNatRuleRow(rule, index, device, isEditable) {
    const tr = document.createElement("tr");
    const createInput = (val, placeholder) => {
      const td = document.createElement("td");
      const input = document.createElement("input");
      input.type = "text";
      input.value = val ? (typeof val === "number" ? ipToString(val) : val) : "";
      input.placeholder = placeholder;
      input.disabled = !isEditable;
      input.readOnly = !isEditable;
      input.style.width = "95%";
      td.appendChild(input);
      return { td, input };
    };

    const publicIp = createInput(ipToString(rule.public_ip), "IP Pub.");
    const publicMask = createInput(maskToString(rule.public_mask), "Masque");
    const privateIp = createInput(ipToString(rule.private_ip), "IP Priv.");
    const privateMask = createInput(maskToString(rule.private_mask), "Masque");

    tr.append(publicIp.td, publicMask.td, privateIp.td, privateMask.td);

    if (isEditable) {
      const actionsTd = document.createElement("td");
      actionsTd.style.display = "flex";
      actionsTd.style.gap = "2px";

      // Bouton Monter
      const upBtn = document.createElement("button");
      upBtn.textContent = "↑";
      upBtn.className = "btn secondary";
      upBtn.style.padding = "2px 5px";
      upBtn.disabled = index <= 0;
      upBtn.onclick = () => {
        syncFirewallFromUI(device);
        const rules = device.firewall.natRules;
        [rules[index], rules[index - 1]] = [rules[index - 1], rules[index]];
        renderFirewallRules(device);
      };

      // Bouton Descendre
      const downBtn = document.createElement("button");
      downBtn.textContent = "↓";
      downBtn.className = "btn secondary";
      downBtn.style.padding = "2px 5px";
      downBtn.disabled = index === -1 || index >= device.firewall.natRules.length - 1;
      downBtn.onclick = () => {
        syncFirewallFromUI(device);
        const rules = device.firewall.natRules;
        [rules[index], rules[index + 1]] = [rules[index + 1], rules[index]];
        renderFirewallRules(device);
      };

      const deleteBtn = document.createElement("button");
      deleteBtn.textContent = "🗑️";
      deleteBtn.className = "btn danger";
      deleteBtn.style.padding = "2px 5px";
      deleteBtn.onclick = () => {
        syncFirewallFromUI(device);
        device.firewall.natRules.splice(index, 1);
        renderFirewallRules(device);
      };

      actionsTd.append(upBtn, downBtn, deleteBtn);
      tr.appendChild(actionsTd);
    }

    return tr;
  }

  /**
   * Synchronise l'état des tableaux Firewall de l'interface vers le modèle (Device).
   * Cette fonction ne valide pas la complétude des règles pour permettre le tri fluide.
   */
  function syncFirewallFromUI(device) {
    if (!device.firewall) return;

    // 1. Extraction des ACL
    const newAccessRules = [];
    firewallAccessRulesBody.querySelectorAll("tr").forEach(row => {
      const inputs = row.querySelectorAll("input");
      const select = row.querySelector("select");
      if (inputs.length < 5) return;

      const srcIp = inputs[0].value.trim() || null;
      const srcMask = inputs[1].value.trim() || null;
      const dstIp = inputs[2].value.trim() || null;
      const dstMask = inputs[3].value.trim() || null;
      const protoInput = inputs[4].value.trim() || null;

      const proto = protoInput ? protoInput.split(',').map(p => p.trim()).filter(p => p !== "") : null;
      const action = select.value;

      if (srcIp || srcMask || dstIp || dstMask || protoInput) {
        newAccessRules.push({
          src_ip: srcIp, src_mask: srcMask,
          dst_ip: dstIp, dst_mask: dstMask,
          protocol: proto, action
        });
      }
    });

    // 2. Extraction du NAT
    const newNatRules = [];
    firewallNatRulesBody.querySelectorAll("tr").forEach(row => {
      const inputs = row.querySelectorAll("input");
      if (inputs.length < 4) return;

      const pubIp = inputs[0].value.trim() || null;
      const pubMask = inputs[1].value.trim() || null;
      const privIp = inputs[2].value.trim() || null;
      const privMask = inputs[3].value.trim() || null;

      if (pubIp || privIp) {
        newNatRules.push({
          public_ip: pubIp, public_mask: pubMask,
          private_ip: privIp, private_mask: privMask
        });
      }
    });

    // Mise à jour du modèle
    device.firewall.clearAccessRules();
    newAccessRules.forEach(r => device.firewall.addAccessRule(r.src_ip, r.src_mask, r.dst_ip, r.dst_mask, r.protocol, r.action));

    device.firewall.clearNatRules();
    newNatRules.forEach(r => device.firewall.addNatRule(r.public_ip, r.public_mask, r.private_ip, r.private_mask));

    const policySelect = document.getElementById("firewallDefaultPolicy");
    if (policySelect) {
      device.firewall.defaultPolicy = policySelect.value;
    }
  }

  function saveFirewallData(device) {
    if (!device.firewall) return;

    let globalError = false;

    // Validation stricte : IP + Masque obligatoires
    firewallAccessRulesBody.querySelectorAll("tr").forEach(row => {
      const inputs = row.querySelectorAll("input");
      if (inputs.length < 5) return;
      const srcIp = inputs[0].value.trim();   const srcM = inputs[1].value.trim();
      const dstIp = inputs[2].value.trim();   const dstM = inputs[3].value.trim();

      // Si l'IP est remplie, le masque doit l'être (et vice versa pour la cohérence)
      if ((srcIp && !srcM) || (dstIp && !dstM)) {
        globalError = "Le masque est obligatoire pour chaque adresse IP saisie.";
      }

      // Validation réelle via networkUtils
      if (srcIp && !validateIPv4(srcIp).valid) globalError = `IP Source invalide : ${srcIp}`;
      if (srcM && !validateMask(srcM).valid) globalError = `Masque Source invalide : ${srcM}`;
      if (dstIp && !validateIPv4(dstIp).valid) globalError = `IP Destination invalide : ${dstIp}`;
      if (dstM && !validateMask(dstM).valid) globalError = `Masque Destination invalide : ${dstM}`;
      
      if (globalError) {
        inputs[0].style.borderColor = "red";
      }
    });
    
    firewallNatRulesBody.querySelectorAll("tr").forEach(row => {
      const inputs = row.querySelectorAll("input");
      if (inputs.length < 4) return;
      const pubIp = inputs[0].value.trim();   const pubM = inputs[1].value.trim();
      const privIp = inputs[2].value.trim();  const privM = inputs[3].value.trim();

      // Détection de conflit NAT
      const currentNatRules = Array.from(firewallNatRulesBody.querySelectorAll("tr"))
        .map(r => ({ public_ip: r.querySelectorAll("input")[0].value.trim() }))
        .filter(r => r.public_ip !== "" && r.public_ip !== pubIp);

      if (pubIp && NetworkUtils.hasNatConflict(currentNatRules, pubIp)) globalError = `Conflit NAT : l'IP publique ${pubIp} est déjà utilisée par une autre règle.`;
      if ((pubIp && !pubM) || (privIp && !privM)) globalError = "Masque obligatoire pour le NAT.";
      
      if (pubIp && !validateIPv4(pubIp).valid) globalError = `IP Publique invalide : ${pubIp}`;
      if (privIp && !validateIPv4(privIp).valid) globalError = `IP Privée invalide : ${privIp}`;
      if (pubM && !validateMask(pubM).valid) globalError = `Masque NAT invalide : ${pubM}`;
    });

    if (globalError) {
      alert(globalError);
      return;
    }

    syncFirewallFromUI(device);

    firewallEditor.classList.add("hidden");
    devicesInteractionLeft.classList.remove("hidden");
    resetSimulationRuntime();
    refresh();
  }

  function renderConsole(device) {
    // Éviter de réinitialiser la console si elle est déjà ouverte pour ce device
    if (activeConsoleDeviceId === device.id && consoleContainer.style.display === "flex") {
      return;
    }

    activeConsoleDeviceId = device.id;
    consoleContainer.style.display = "flex";
    appendConsoleLine(consoleOutput, "Utilisez la commande help pour obtenir la liste des commandes disponibles sur cet appareil.");

    consoleInput.onkeydown = (event) => {
      if (event.key !== "Enter") {
        return;
      }

      event.preventDefault();
      const command = consoleInput.value.trim();
      if (!command) {
        return;
      }

      consoleInput.value = "";
      consoleOutput.innerHTML = "";
      appendConsoleLine(consoleOutput, `> ${command}`);

      const result = engine.executeCommand(device, command);
      setSimulationResult(result);

      if (result.timeline.length === 0) {
        appendConsoleLine(consoleOutput, "Aucune sortie.");
      } else {
        result.timeline.forEach((step) => {
          const line = formatTimelineStep(step);
          const prefix = step.event.type === "initial-state" ? "" : `${step.index}. `;
          appendConsoleLine(consoleOutput, prefix + line);
        });
      }

      if (eventBus) {
        eventBus.publish('pingFlagFound', { flag: result.flag || null, allPingsValidated: result.allPingsValidated });
      }
      if (result.flag) {
        appendConsoleLine(consoleOutput, `Flag: ${result.flag}`);
      }
    };
  }

  function renderInterfaceEditor(device, ifaceIndex) {
    const iface = device.interfaces[ifaceIndex];
    titleElement.textContent = `INTERFACE - ${device.name}.${iface.name}`;

    const status = document.createElement("p");
    status.id = "status";
    status.textContent = iface.link
      ? `Reliée à ${iface.link.otherSide(iface).parentDevice.name}.`
      : "Aucun lien sur cette interface.";
    deviceInfos.appendChild(status);

    const isL3Device = ["pc", "server", "router"].includes(device.type);

    if (isL3Device) {
      deviceInfos.appendChild(createLabeledInput(
        "text",
        ipToString(iface.ip),
        "Adresse IP",
        "Notation décimale pointée",
        !!iface.editable,
        (event) => {
          const result = commitIPv4(event.target.value, (value) => iface.setIp(value), device);
          if (result.success) {
            resetSimulationRuntime();
            canvasView.draw();
            if (device.consoleAccessible && consoleContainer.style.display !== "none") {
              consoleOutput.innerHTML = ""; // Clear previous console errors
            }
          } else if (device.consoleAccessible) {
            consoleContainer.style.display = "flex"; // Ensure console is visible
            consoleOutput.innerHTML = "";
            appendConsoleLine(consoleOutput, `Erreur de configuration IP: ${formatConsoleEvent({ type: "error", code: result.code, input: result.input })}`);
          }
        },
      ));

      deviceInfos.appendChild(createLabeledInput(
        "text",
        maskToString(iface.mask),
        "Masque",
        "Notation CIDR ou decimale",
        !!iface.editable,
        (event) => {
          const result = commitMask(event.target.value, (value) => iface.setMask(value), device);
          if (result.success) {
            resetSimulationRuntime();
            canvasView.draw();
            if (device.consoleAccessible && consoleContainer.style.display !== "none") {
              consoleOutput.innerHTML = ""; // Clear previous console errors
            }
          } else if (device.consoleAccessible) {
            consoleContainer.style.display = "flex"; // Ensure console is visible
            consoleOutput.innerHTML = "";
            appendConsoleLine(consoleOutput, `Erreur de configuration Masque: ${formatConsoleEvent({ type: "error", code: result.code, input: result.input })}`);
          }
        },
      ));
    }

    if ((device.type === "pc" || device.type === "server") && ifaceIndex === 0) {
      deviceInfos.appendChild(createLabeledInput(
        "text",
        ipToString(device.gateway),
        "Passerelle par défaut",
        "Notation decimale pointée",
        !!iface.editable, // Gateway editability depends on the interface's editability
        (event) => {
          const result = commitIPv4(event.target.value, (value) => device.setGateway(value), device);
          if (result.success) {
            resetSimulationRuntime();
            canvasView.draw();
            if (device.consoleAccessible && consoleContainer.style.display !== "none") {
              consoleOutput.innerHTML = ""; // Clear previous console errors
            }
          } else if (device.consoleAccessible) {
            consoleContainer.style.display = "flex"; // Ensure console is visible
            consoleOutput.innerHTML = "";
            appendConsoleLine(consoleOutput, `Erreur de configuration Passerelle: ${formatConsoleEvent({ type: "error", code: result.code, input: result.input })}`);
          }
        },
      ));
    }

    if (device.consoleAccessible) {
      renderConsole(device);
    }
    
  }

  linkButton.addEventListener("click", () => {
    if (
      canvasView.selectedNodes.length !== 2
      || !canvasView.selectedNodes.every((node) => node.type === "iface")
    ) {
      return;
    }

    const [nodeA, nodeB] = canvasView.selectedNodes;
    const deviceA = network.findDeviceById(nodeA.deviceId);
    const deviceB = network.findDeviceById(nodeB.deviceId);
    const interfaceA = deviceA.interfaces[nodeA.index];
    const interfaceB = deviceB.interfaces[nodeB.index];
    const existingLink = network.findLinkBetween(interfaceA, interfaceB);
    
    if (existingLink && interfaceA.linkable && interfaceB.linkable) {
      network.removeLink(existingLink);
    } else if (!existingLink && !interfaceA.link && !interfaceB.link && deviceA !== deviceB) {
      network.addLink(interfaceA, interfaceB, interfaceA.linkable && interfaceB.linkable); // Link is editable only if both interfaces are
    }

    clearSimulationResult(); // On vide la vue simulation mais on garde la mémoire (ARP/MAC/Routes)
    canvasView.clearSelection();
  });

  simAutoBtn.addEventListener("click", () => setSimulationMode("auto"));
  simPauseBtn.addEventListener("click", () => {
    stopAutoPlay();
    renderSimulation();
  });
  simSpeedRange.addEventListener("input", (e) => {
    simulationState.autoPlayInterval = parseInt(e.target.value, 10);
    if (autoPlayTimer) startAutoPlay(); // Redémarre avec la nouvelle vitesse si déjà en lecture
  });
  simStepBtn.addEventListener("click", () => setSimulationMode("step"));
  simPrevBtn.addEventListener("click", () => jumpToStep(simulationState.currentStepIndex - 1));
  simNextBtn.addEventListener("click", () => jumpToStep(simulationState.currentStepIndex + 1));
  simResetBtn.addEventListener("click", () => {
    resetSimulationRuntime();
    refresh();
  });

  renderScenarioIntro(consignePanel, scenario);
  setUIMode("config");
  renderSimulation();

  return {
    refresh,
    setSimulationResult,
    handleTopologyMutation: resetSimulationRuntime,
  };
}
