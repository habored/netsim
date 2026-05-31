import { SimulationEngine } from "./src/js/simulation-engine.js";
import { createScenarioFromJSON } from "./src/js/scenarioLoader.js";
import { CanvasNetworkView } from "./src/js/canvas-view.js";
import { createPanelController, setupModalPanel, renderScenarioIntro } from "./src/js/panel-controller.js";
import { EventBus } from "./src/js/event-bus.js";

/**
 * Chargement dynamique des scénarios via Vite
 */
const scenarioModules = import.meta.glob("./src/scenarios/*.json", {
  eager: true
});

export function loadScenarios() {
  const scenarios = Object.entries(scenarioModules).map(([path, mod]) => {
    const data = mod.default;
    // Calcul du flag final par concaténation si non défini explicitement
    const computedFlag = (data.pingsToValidate || []).map(p => p.flag).join('');
    return {
      file: path,
      ...data,
      finalFlag: data.finalFlag || computedFlag
    };
  });
  // Tri alphanumérique basé sur le 'code' (ou 'id') défini dans le JSON
  return scenarios.sort((a, b) => String(a.code).localeCompare(String(b.code), undefined, { numeric: true }));
}

const AVAILABLE_SCENARIOS = loadScenarios();

// --- Challenge Manager State and Logic ---
const CHALLENGE_PROGRESS_KEY = "netsim_challenge_progress";
let challengeProgress = []; // Array of { status: 'locked'|'unlocked'|'completed', enteredFlag: string, bilanViewed: boolean, realSuccess: boolean }
let lastOpenedBilanIndex = -1;
let currentScenarioIndex = -1; // Index of the currently loaded scenario
let currentScenarioInstance = null; // Store the loaded scenario object
let currentEngineInstance = null; // Store the loaded engine instance
let currentPanelController = null; // Store the loaded panel controller instance
let currentCanvasView = null; // Store the loaded canvas view instance
const globalEventBus = new EventBus();

// UI elements for challenge path
const challengePathBlur = document.getElementById("challengePathBlur");
const challengePathPanel = document.getElementById("challengePathPanel");
const challengeList = document.getElementById("challengeList");
const menuChallengesBtn = document.getElementById("menuChallengesBtn");
const resetProgressBtn = document.getElementById("resetProgressBtn");
const closeChallengePathBtn = document.getElementById("closeChallengePathBtn");

// UI elements for bilan
const bilanPanel = document.getElementById("bilanPanel");
const bilanTitle = document.getElementById("bilanTitle");
const bilanContent = document.getElementById("bilanContent");
const closeBilanBtn = document.getElementById("closeBilanBtn");
const bilanRetainBtn = document.getElementById("bilanRetainBtn");

// UI elements for consigne
const consigneBlur = document.getElementById("consigneBlur");
const consigneBtn = document.getElementById("consigneBtn");
const startChallengeBtn = document.getElementById("startChallengeBtn"); // Bouton pour fermer la consigne
// Initialise la modale des consignes une seule fois. Pas de bouton déclencheur pour l'ouverture automatique.
const consigneModalPanel = setupModalPanel(consigneBlur, consigneBtn, false); // Supposons que la consigne est toujours en plein écran
if (startChallengeBtn) {
  startChallengeBtn.addEventListener("click", () => {
    consigneModalPanel.close();
    // Déclenche une salve de convergence sur tous les routeurs dès que l'élève ferme les consignes
    // On effectue deux passes pour assurer la découverte des voisins et la propagation des routes (convergence accélérée)
    if (currentScenarioInstance) {
      for (let pass = 0; pass < 2; pass++) {
        currentScenarioInstance.network.devices.forEach(device => {
          if (device.type === "router" && typeof device.syncRoutingDaemons === "function") {
            if (!device.eventBus) device.eventBus = globalEventBus;
            device.syncRoutingDaemons();
          }
        });
      }
    }
  });
}
// UI elements for challenges' menu
const challengePathModal = setupModalPanel(challengePathBlur, menuChallengesBtn, true);
const bilanBlur = document.getElementById("bilanBlur");
const bilanModal = setupModalPanel(bilanBlur, null, true);
// Déclenche le déblocage et le chargement du prochain défi après lecture du bilan
bilanRetainBtn.addEventListener("click", () => {
  if (lastOpenedBilanIndex !== -1) {
    checkAndUnlockNextChallenge(lastOpenedBilanIndex);
  }
});
// UI elements for help menu
const helpBtn = document.getElementById("helpBtn");
const helpBlur = document.getElementById("helpBlur");
setupModalPanel(helpBlur, helpBtn, true);

function saveProgress() {
  localStorage.setItem(CHALLENGE_PROGRESS_KEY, JSON.stringify(challengeProgress));
}

function loadProgress() {
  const savedProgress = localStorage.getItem(CHALLENGE_PROGRESS_KEY);
  if (savedProgress) {
    challengeProgress = JSON.parse(savedProgress);
    // S'assure que le tableau de progression correspond à la liste actuelle des fichiers
    while (challengeProgress.length < AVAILABLE_SCENARIOS.length) {
      challengeProgress.push({
        status: "locked",
        enteredFlag: "",
        bilanViewed: false,
        realSuccess: false,
      });
    }
  } else {
    // Initialize progress: first scenario unlocked, others locked
    challengeProgress = AVAILABLE_SCENARIOS.map((_, index) => ({
      status: index === 0 ? "unlocked" : "locked",
      enteredFlag: "",
      bilanViewed: false,
      realSuccess: false, // This will be set by the simulation engine
    }));
  }
  saveProgress();
}

async function renderChallengePath() {
  if (!challengeList) return;
  challengeList.innerHTML = ""; // Clear previous list

  for (let i = 0; i < AVAILABLE_SCENARIOS.length; i++) {
    const scenarioMeta = AVAILABLE_SCENARIOS[i];

    const progress = challengeProgress[i];
    const challengeCard = document.createElement("div");
    challengeCard.className = `challenge-card ${progress.status}`;
    if (i === currentScenarioIndex) {
      challengeCard.classList.add("active-challenge");
    }

    const title = document.createElement("h3");
    title.textContent = `${scenarioMeta.code}. ${scenarioMeta.title}`;
    challengeCard.appendChild(title);

    const objectif = document.createElement("p");
    objectif.textContent = scenarioMeta.objectif;
    challengeCard.appendChild(objectif);

    const flagInputContainer = document.createElement("div");
    flagInputContainer.className = "flag-input-container";
    challengeCard.appendChild(flagInputContainer);
    
    if (progress.enteredFlag && progress.realSuccess) {
      // If flag is entered and real success achieved, show "Voir le bilan" button
      const retainBilanBtn = document.createElement("button");
      retainBilanBtn.textContent = "Voir le bilan";
      retainBilanBtn.className = "btn view-bilan-btn";
      retainBilanBtn.addEventListener("click", () => showBilan(i));
      flagInputContainer.appendChild(retainBilanBtn);
    } else if (progress.status !== "locked") {
      // Only show input if not locked
      const flagInput = document.createElement("input");
      flagInput.type = "text";
      flagInput.placeholder = "Entrez le FLAG ici";
      flagInput.value = progress.enteredFlag;
      flagInput.disabled = progress.status === "locked";
      flagInputContainer.appendChild(flagInput);

      const validateFlagBtn = document.createElement("button");
      validateFlagBtn.textContent = "Valider";
      validateFlagBtn.className = "btn validate-flag-btn";
      validateFlagBtn.disabled = progress.status === "locked";
      validateFlagBtn.addEventListener("click", () => {
        validateFlag(i, flagInput.value.trim());
      });
      flagInputContainer.appendChild(validateFlagBtn);
    }

    challengeList.appendChild(challengeCard);
  }
}

async function loadChallenge(index) {
  currentScenarioIndex = index;
  challengePathModal.close(); // Close the challenge path modal

  try {
    const scenarioData = AVAILABLE_SCENARIOS[index];
    const scenario = createScenarioFromJSON(scenarioData);
    currentScenarioInstance = scenario; // Store the loaded scenario

    // Clear existing UI and re-initialize
    const topologyContainer = document.getElementById("topology");
    topologyContainer.innerHTML = ''; // Clear previous scenario UI

    const canvas = document.createElement("canvas");
    canvas.id = "networkCanvas";
    topologyContainer.appendChild(canvas);

    // Re-create other necessary UI elements if they were cleared
    // For now, assume panel-controller creates its own elements or they are static.

    const engine = new SimulationEngine(scenario.network, scenario, globalEventBus);
    currentEngineInstance = engine; // Store the engine instance
    engine.start(); // Démarre l'horloge pour la convergence RIP/OSPF
    currentCanvasView = new CanvasNetworkView(canvas, scenario.network);

    currentPanelController = createPanelController({
      scenario,
      network: scenario.network,
      canvasView: currentCanvasView,
      engine,
      eventBus: globalEventBus,
    });

    currentCanvasView.onSelectionChange = () => currentPanelController.refresh();
    currentCanvasView.onTopologyChange = () => currentPanelController.handleTopologyMutation();

    currentPanelController.refresh();
    currentCanvasView.draw();

    // Rend le contenu de l'introduction du scénario et ouvre la modale
    const consignePanel = document.getElementById("consignePanel"); // Nécessaire pour rendre le contenu de l'intro
    renderScenarioIntro(consignePanel, scenario);
    consigneModalPanel.open();

    renderChallengePath(); // Re-render challenge path to mark current scenario

  } catch (error) {
    console.error(`Error loading scenario index ${index}:`, error);
  }
}

async function validateFlag(index, enteredFlag) {
  const scenarioData = AVAILABLE_SCENARIOS[index];

  if (enteredFlag === scenarioData.finalFlag) {
    challengeProgress[index].enteredFlag = enteredFlag;
    saveProgress();
    
    if (challengeProgress[index].realSuccess) {
      alert("Flag correct ! Vous pouvez maintenant voir le bilan.");
    } else {
      alert("Flag correct ! Cependant, vous devez réussir l'objectif de connectivité dans le simulateur (ping) pour valider ce défi.");
    }
    renderChallengePath(); // Re-render to show "Voir le bilan" button
  } else {
    alert("Flag incorrect. Réessayez !");
  }
}

async function showBilan(index) {
  const progress = challengeProgress[index];
  if (!progress.enteredFlag || !progress.realSuccess) {
    alert("Veuillez d'abord entrer le flag et réussir le défi technique pour accéder au bilan.");
    return;
  }

  const scenarioData = AVAILABLE_SCENARIOS[index];
  lastOpenedBilanIndex = index;

  // Mark bilan as viewed
  progress.bilanViewed = true;
  saveProgress();

  bilanTitle.textContent = `Bilan : ${scenarioData.title}`;

  try {
    const response = await fetch(`./src/scenarios/${scenarioData.code}-bilan.html`);
    if (!response.ok) throw new Error("Fichier bilan introuvable");
    const html = await response.text();
    bilanContent.innerHTML = html;
  } catch (err) {
    console.warn(`Erreur lors du chargement du bilan pour ${scenarioData.code}:`, err);
    bilanContent.innerHTML = `
      <p>Félicitations ! Vous avez complété le défi.</p>
      <p>Flag entré : <strong>${progress.enteredFlag}</strong></p>
      <p class="muted">Note : Le contenu pédagogique détaillé n'est pas disponible pour ce scénario.</p>
    `;
  }

  bilanModal.open();
}

function checkAndUnlockNextChallenge(completedChallengeIndex) {
  const progress = challengeProgress[completedChallengeIndex];

  // Condition 1: The flag was genuinely achieved (realSuccess)
  // Condition 2: The bilan has been opened
  if (progress.realSuccess && progress.bilanViewed) {
    const nextIndex = completedChallengeIndex + 1;
    if (nextIndex < AVAILABLE_SCENARIOS.length) {
      const nextChallengeProgress = challengeProgress[nextIndex];

      // Débloque le suivant si nécessaire
      if (nextChallengeProgress.status === "locked") {
        nextChallengeProgress.status = "unlocked";
        saveProgress();
      }

      bilanModal.close();
      alert(`Félicitations ! Chargement du défi suivant : ${AVAILABLE_SCENARIOS[nextIndex].title}`);
      loadChallenge(nextIndex);
    } else {
      alert("Félicitations ! Vous avez terminé tous les défis !");
      bilanModal.close();
    }
  }
}

// Listen for custom event from panel-controller when a ping flag is found
globalEventBus.subscribe('pingFlagFound', (detail) => {
  const { allPingsValidated } = detail;
  if (currentScenarioIndex !== -1 && allPingsValidated) {
    challengeProgress[currentScenarioIndex].realSuccess = true;
    saveProgress();
    renderChallengePath(); // Rafraîchit pour afficher "Voir le bilan" si le flag est déjà là

    if (challengeProgress[currentScenarioIndex].bilanViewed) {
      checkAndUnlockNextChallenge(currentScenarioIndex);
    }
  }
});

// Écoute les mises à jour de protocoles de routage (RIP, OSPF) déclenchées par les daemons des routeurs
let redrawTimer = null;
globalEventBus.subscribe('routingUpdate', (detail) => {
  const { source, protocol } = detail;
  if (currentEngineInstance && currentPanelController) {
    // On exécute la logique du protocole (mise à jour des tables internes)
    currentEngineInstance.processProtocolActivity(source, protocol);

    // On rafraîchit la vue et les tableaux de bord sans écraser la simulation en cours
    const view = currentCanvasView; // Capture la vue actuelle
    if (view) {
      view.draw();
      if (redrawTimer) clearTimeout(redrawTimer);
      redrawTimer = setTimeout(() => view.draw(), 850);
    }

    // Met à jour les tables de routage affichées dans l'onglet "Configuration" 
    // si l'utilisateur est en train d'en regarder une.
    currentPanelController.refresh();
  }
});

if (resetProgressBtn) {
  resetProgressBtn.addEventListener("click", () => {
    if (confirm("Voulez-vous vraiment réinitialiser toute votre progression ? Cette action est irréversible.")) {
      localStorage.removeItem(CHALLENGE_PROGRESS_KEY);
      window.location.reload();
    }
  });
}

/**
 * Initialisation sécurisée de Nesiin v1.1
 */
const initializeNesiin = async () => {
  try {
    loadProgress();
    await renderChallengePath();

    // Au démarrage, on charge le dernier défi débloqué
    let indexToLoad = 0;
    for (let i = challengeProgress.length - 1; i >= 0; i--) {
      if (challengeProgress[i].status !== "locked") {
        indexToLoad = i;
        break;
      }
    }

    await loadChallenge(indexToLoad);
    challengePathModal.open();
  } catch (error) {
    console.error("❌ Erreur fatale lors du chargement :", error);
  }
};

// Correction du bug d'écoute : vérification de l'état du document pour les modules
if (document.readyState === "complete" || document.readyState === "interactive") {
  initializeNesiin();
} else {
  window.addEventListener("load", initializeNesiin);
}
