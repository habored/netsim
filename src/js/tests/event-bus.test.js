import { EventBus } from "../event-bus.js";

/**
 * Nesiin v1.1 - Suite de tests unitaires pour le moteur d'événements
 * Valide la communication découplée entre le SimulationEngine et l'UI.
 */
export function runEventBusTests() {
    console.group("🧪 Tests EventBus : Communication Découplée");

    const bus = new EventBus();
    let callCountA = 0;
    let callCountB = 0;
    let lastData = null;

    // 1. Test : Inscription et Publication Simple
    bus.subscribe("pingFlagFound", (data) => {
        callCountA++;
        lastData = data;
    });

    bus.publish("pingFlagFound", { flag: "CONGRATS_V1_1" });

    if (callCountA === 1 && lastData?.flag === "CONGRATS_V1_1") {
        console.log("✅ [PASS] Publication et réception simples.");
    } else {
        console.error("❌ [FAIL] Échec de la réception de l'événement.");
    }

    // 2. Test : Multi-souscription (Pattern essentiel pour Canvas + Console)
    bus.subscribe("pingFlagFound", () => {
        callCountB++;
    });

    bus.publish("pingFlagFound", { flag: "ANOTHER_ONE" });
    
    if (callCountA === 2 && callCountB === 1) {
        console.log("✅ [PASS] Notification de multiples abonnés simultanés.");
    } else {
        console.error("❌ [FAIL] Problème lors de la multi-souscription.");
    }

    // 3. Test : Isolation des Topics (Routage vs Simulation)
    let routingCalled = false;
    bus.subscribe("routingUpdate", () => {
        routingCalled = true;
    });

    bus.publish("pingFlagFound", {}); // Ne doit pas déclencher routingUpdate
    if (!routingCalled) {
        console.log("✅ [PASS] Isolation des canaux de communication respectée.");
    } else {
        console.error("❌ [FAIL] Fuite d'événement entre deux sujets différents.");
    }

    // 4. Test : Convergence RIP (Poison Reverse)
    console.group("🔄 Test Convergence RIP v1.1");
    let ripUpdateReceived = false;
    bus.subscribe("netsim:routingUpdate", (data) => {
        if (data.protocol === "RIP") ripUpdateReceived = true;
    });

    // Simulation d'une coupure d'interface
    // On vérifie que le Triggered Update est envoyé
    // Nouveau format d'événement découplé v1.1
    let activityDetected = false;
    bus.subscribe("routing:protocol_activity", (data) => {
        if (data.protocol === "RIP") activityDetected = true;
    });

    const router = new Router("R1");
    router.eventBus = bus;
    router.broadcastRipUpdate();
    
    if (activityDetected) {
        console.log("✅ [PASS] Triggered Update RIP détecté sur l'EventBus.");
    } else {
        console.error("❌ [FAIL] Le changement de topologie n'a pas déclenché de mise à jour immédiate.");
    }
    console.groupEnd();
}

runEventBusTests();