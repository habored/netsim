import { SimulationEngine } from "../simulation-engine.js";
import { Router } from "../devices.js";
import { Packet, RIPMessage } from "../network-core.js";
import { EventBus } from "../event-bus.js";
import { normalizeIPv4Value, ipToString } from "../networkUtils.js";

/**
 * Test d'intégration : Simulation de coupure de lien et Hold-down RIP
 */
export async function testRipPoisoningAndHoldDown() {
    console.group("🧪 Test Intégration : RIP Poisoning & Hold-down");
    
    const bus = new EventBus();
    const engine = new SimulationEngine({ devices: [] }, {}, bus);
    
    // 1. Setup du Routeur R1
    const r1 = new Router(1, "R1", 2);
    r1.eventBus = bus;
    r1.enabledProtocols = ["RIP"];
    const eth0 = r1.getPrimaryInterface();
    eth0.setIp("10.0.0.1");
    eth0.setMask("255.255.255.0");

    const targetNetwork = normalizeIPv4Value("10.10.10.0");
    const targetMask = normalizeIPv4Value("255.255.255.0");
    const neighborR2 = normalizeIPv4Value("10.0.0.2");
    const neighborR3 = normalizeIPv4Value("10.0.0.3");

    // 2. Apprentissage initial (R2 annonce le réseau avec un coût de 1)
    console.log("Étape 1 : Apprentissage de la route via R2...");
    const initialUpdate = new RIPMessage([{ networkIp: targetNetwork, networkMask: targetMask, cost: 1 }]);
    const p1 = new Packet(neighborR2, eth0.ip, initialUpdate, 1, "UDP");
    
    engine.handleRipOnRouter(r1, eth0, p1, initialUpdate);
    
    let route = r1.routingTable.find(r => r.networkIp === targetNetwork);
    if (route && route.cost === 2) {
        console.log("✅ Route apprise correctement (Coût 2)");
    } else {
        console.error("❌ Échec de l'apprentissage initial");
    }

    // 3. Simulation de l'empoisonnement (R2 annonce une métrique de 16)
    console.log("Étape 2 : Réception d'un Poison Reverse de R2 (Métrique 16)...");
    const poisonUpdate = new RIPMessage([{ networkIp: targetNetwork, networkMask: targetMask, cost: 16 }]);
    const p2 = new Packet(neighborR2, eth0.ip, poisonUpdate, 1, "UDP");
    
    engine.handleRipOnRouter(r1, eth0, p2, poisonUpdate);
    
    route = r1.routingTable.find(r => r.networkIp === targetNetwork);
    if (route && route.cost === 16 && route.poisonedAt) {
        console.log("✅ Route empoisonnée avec succès (Métrique 16 + Timestamp)");
    } else {
        console.error("❌ La route n'a pas été empoisonnée correctement");
    }

    // 4. Test du Hold-down (R3 tente d'offrir une meilleure route pendant le hold-down)
    console.log("Étape 3 : Tentative d'injection par R3 pendant le Hold-down...");
    const r3Update = new RIPMessage([{ networkIp: targetNetwork, networkMask: targetMask, cost: 4 }]);
    const p3 = new Packet(neighborR3, eth0.ip, r3Update, 1, "UDP");
    
    // On traite le message de R3
    engine.handleRipOnRouter(r1, eth0, p3, r3Update);

    route = r1.routingTable.find(r => r.networkIp === targetNetwork);
    if (route && route.cost === 16) {
        console.log("✅ Hold-down respecté : La mise à jour de R3 a été ignorée.");
    } else {
        console.error("❌ ÉCHEC : Le routeur a accepté une route instable pendant le hold-down !");
    }

    // 5. Sortie de Hold-down (Simulation du passage du temps > 30s)
    console.log("Étape 4 : Fin du Hold-down...");
    route.poisonedAt = Date.now() - 31000; // On recule le temps artificiellement
    
    engine.handleRipOnRouter(r1, eth0, p3, r3Update);
    
    route = r1.routingTable.find(r => r.networkIp === targetNetwork);
    if (route && route.cost === 5) {
        console.log("✅ Route mise à jour après expiration du Hold-down (Coût 5)");
    } else {
        console.error("❌ La route n'a pas été mise à jour après le hold-down");
    }

    console.groupEnd();
}

// Exécution du test
testRipPoisoningAndHoldDown();