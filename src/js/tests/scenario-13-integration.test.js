import { SimulationEngine } from "../simulation-engine.js";
import { Router } from "../devices.js";
import { Packet, RIPMessage, OSPFMessage } from "../network-core.js";
import { EventBus } from "../event-bus.js";
import { normalizeIPv4Value, ipToString } from "../networkUtils.js";

/**
 * Test de comparaison de convergence : RIP vs OSPF
 * Scénario : R1 <-> R2 <-> R3. R3 découvre un nouveau réseau. 
 * On mesure le nombre d'étapes de propagation pour que R1 apprenne la route.
 */
export async function compareConvergenceSpeed() {
    console.group("🧪 Test Comparatif : Vitesse de Convergence RIP vs OSPF");
    
    // Injection du Bus d'événements pour un suivi déterministe
    const bus = new EventBus();
    
    // Le SimulationEngine reçoit maintenant le bus en paramètre
    const engine = new SimulationEngine({ devices: [] }, {}, bus);

    // Configuration de la topologie R1 -- R2 -- R3
    const setupTopology = (protocol) => {
        const r1 = new Router(1, "R1", 2);
        const r2 = new Router(2, "R2", 2);
        const r3 = new Router(3, "R3", 2);
        
        [r1, r2, r3].forEach(r => {
            r.eventBus = bus;
            r.enabledProtocols = [protocol];
        });

        // Adresses IP pour les liens
        r1.getPrimaryInterface().setIp("10.0.1.1"); // vers R2
        r2.interfaces[0].setIp("10.0.1.2");         // vers R1
        r2.interfaces[1].setIp("10.0.2.1");         // vers R3 (eth1)
        r3.getPrimaryInterface().setIp("10.0.2.2"); // vers R2

        return { r1, r2, r3 };
    };

    const targetNet = normalizeIPv4Value("192.168.100.0");
    const targetMask = normalizeIPv4Value("255.255.255.0");

    // --- TEST OSPF ---
    console.log("\n--- Analyse OSPF ---");
    const ospfNodes = setupTopology("OSPF");
    
    // R3 découvre le réseau (ajout d'une route statique/connectée qui déclenche un LSA)
    ospfNodes.r3.addRoute(targetNet, targetMask, null, "eth1", 1, "connected");
    
    // Dans Nesiin, handleOspfLsa contient la logique de flooding immédiat
    const lsaR3 = new OSPFMessage("lsa", { 
        routerId: "R3", 
        neighbors: [{ networkIp: targetNet, networkMask: targetMask, cost: 1 }] 
    });
    const pOspf = new Packet(ospfNodes.r3.getPrimaryInterface().ip, ospfNodes.r2.interfaces[1].ip, lsaR3, 1, "OSPF");

    // Espionnage des événements du bus
    let ospfUpdates = 0;
    bus.subscribe('routingUpdate', () => ospfUpdates++);

    console.log("OSPF: R3 envoie LSA à R2...");
    engine.handleOspfLsa(ospfNodes.r2, ospfNodes.r2.interfaces[1], pOspf, lsaR3);

    // On vérifie si R1 a reçu l'info via le flooding de R2
    const routeR1Ospf = ospfNodes.r1.routingTable.find(r => r.networkIp === targetNet);
    if (routeR1Ospf) {
        console.log(`✅ OSPF Convergence: R1 a appris la route immédiatement via le flooding de R2.`);
        console.log(`   Evénements de routage capturés : ${ospfUpdates}`);
    }

    // --- TEST RIP ---
    console.log("\n--- Analyse RIP ---");
    const ripNodes = setupTopology("RIP");
    
    // R3 découvre le réseau
    ripNodes.r3.addRoute(targetNet, targetMask, null, "eth1", 1, "connected");
    
    // R3 envoie sa mise à jour à R2
    const ripUpdateR3 = new RIPMessage([{ networkIp: targetNet, networkMask: targetMask, cost: 1 }]);
    const pRip1 = new Packet(ripNodes.r3.getPrimaryInterface().ip, ripNodes.r2.interfaces[1].ip, ripUpdateR3, 1, "UDP");
    
    let ripUpdates = 0;
    bus.subscribe('routingUpdate', () => ripUpdates++);
    
    console.log("RIP : R3 envoie sa table à R2...");
    engine.handleRipOnRouter(ripNodes.r2, ripNodes.r2.interfaces[1], pRip1, ripUpdateR3);

    // À ce stade, R2 connaît la route, mais R1 ne sait rien
    let routeR1Rip = ripNodes.r1.routingTable.find(r => r.networkIp === targetNet);
    console.log(`RIP : État de R1 après 1ère étape: ${routeR1Rip ? "Connu" : "Inconnu"}`);

    // R2 doit maintenant envoyer sa propre mise à jour à R1 (cycle suivant)
    const ripUpdateR2 = new RIPMessage([{ networkIp: targetNet, networkMask: targetMask, cost: 2 }]);
    const pRip2 = new Packet(ripNodes.r2.interfaces[0].ip, ripNodes.r1.getPrimaryInterface().ip, ripUpdateR2, 1, "UDP");
    
    console.log("RIP : R2 envoie sa table à R1...");
    engine.handleRipOnRouter(ripNodes.r1, ripNodes.r1.getPrimaryInterface(), pRip2, ripUpdateR2);

    routeR1Rip = ripNodes.r1.routingTable.find(r => r.networkIp === targetNet);
    if (routeR1Rip) {
        console.log(`✅ RIP Convergence: R1 a appris la route (Coût: ${routeR1Rip.cost})`);
        console.log(`   Evénements de routage capturés : ${ripUpdates}`);
    }

    console.log("\nCONCLUSION :");
    console.log("OSPF converge via flooding LSA (immédiat), tandis que RIP attend le cycle de mise à jour (rumor).");
    
    console.groupEnd();
}

compareConvergenceSpeed();