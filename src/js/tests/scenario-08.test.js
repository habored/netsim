import { SimulationEngine } from "../simulation-engine.js";
import { Network } from "../network-core.js";
import { Router } from "../devices.js";
import { EventBus } from "../event-bus.js";
import { ipToString } from "../network-utils.js";

/**
 * Test d'intégration pour le Scénario 08 : Convergence RIP et tolérance aux pannes
 */
export async function runScenario08Test() {
    console.group("🧪 Test Intégration : Scénario 08 (Convergence RIP)");

    const bus = new EventBus();
    const net = new Network();

    // 1. Setup de la topologie linéaire : R1 - R2 - R3 - R4
    // R4 possède le réseau cible (172.16.0.0/24)
    const r1 = new Router("r1", "R1", [{ name: "eth0", ip: "10.0.1.1", mask: "255.255.255.252" }]);
    const r2 = new Router("r2", "R2", [{ name: "eth0", ip: "10.0.1.2", mask: "255.255.255.252" }, { name: "eth1", ip: "10.0.2.1", mask: "255.255.255.252" }]);
    const r3 = new Router("r3", "R3", [{ name: "eth0", ip: "10.0.2.2", mask: "255.255.255.252" }, { name: "eth1", ip: "10.0.3.1", mask: "255.255.255.252" }]);
    const r4 = new Router("r4", "R4", [{ name: "eth0", ip: "10.0.3.2", mask: "255.255.255.252" }, { name: "lan", ip: "172.16.0.1", mask: "255.255.255.0" }]);

    [r1, r2, r3, r4].forEach(r => {
        r.enabledProtocols = ["RIP"];
        r.eventBus = bus;
        net.addDevice(r);
    });

    // Câblage
    const l12 = net.addLink(r1.getInterfaceByName("eth0"), r2.getInterfaceByName("eth0"));
    const l23 = net.addLink(r2.getInterfaceByName("eth1"), r3.getInterfaceByName("eth0"));
    const l34 = net.addLink(r3.getInterfaceByName("eth1"), r4.getInterfaceByName("eth0"));

    const engine = new SimulationEngine(net, null, bus);
    
    // Liaison entre le Bus et le Moteur (comme dans main.js)
    bus.subscribe('routingUpdate', (detail) => {
        engine.processProtocolActivity(detail.source, detail.protocol);
    });

    console.log("--- Étape 1 : Convergence initiale ---");
    // On simule le bouton "Relever le défi" (double passe)
    for(let i=0; i<2; i++) {
        [r1, r2, r3, r4].forEach(r => r.syncRoutingDaemons());
    }

    const checkRoute = (router, dest, expectedMetric) => {
        const route = router.getRoutes().find(r => ipToString(r.networkIp) === dest);
        if (route && route.cost === expectedMetric) {
            console.log(`✅ ${router.name} connaît ${dest} (métrique: ${route.cost})`);
            return true;
        }
        console.error(`❌ ${router.name} : route vers ${dest} incorrecte. Reçu metric ${route?.cost} au lieu de ${expectedMetric}`);
        return false;
    };

    checkRoute(r4, "172.16.0.0", 0); // Connecté
    checkRoute(r3, "172.16.0.0", 1); // 1 saut
    checkRoute(r2, "172.16.0.0", 2); // 2 sauts
    checkRoute(r1, "172.16.0.0", 3); // 3 sauts

    console.log("--- Étape 2 : Coupure du lien R2-R3 (Poisoning) ---");
    net.removeLink(l23);
    // En RIP réel, R2 détecte la coupure et envoie une métrique 16
    r2.routingTable.forEach(r => { if(r.outInterface?.name === "eth1") r.cost = 16; });
    r2.broadcastRipUpdate();
    
    // Propagation du poison
    r1.syncRoutingDaemons(); 

    const routeR1AfterCut = r1.getRoutes().find(r => ipToString(r.networkIp) === "172.16.0.0");
    if (!routeR1AfterCut || routeR1AfterCut.cost >= 16) {
        console.log("✅ R1 a bien invalidé la route vers le serveur (Métrique 16 ou supprimée).");
    } else {
        console.error("❌ Échec : R1 croit toujours pouvoir joindre le serveur via le lien coupé !");
    }

    console.log("--- Étape 3 : Nouveau lien (Shortcut R1-R4) ---");
    // Alice décide de tirer une fibre directe entre R1 et R4
    r1.addInterface("fiber", "10.0.99.1", "255.255.255.252");
    r4.addInterface("fiber", "10.0.99.2", "255.255.255.252");
    net.addLink(r1.getInterfaceByName("fiber"), r4.getInterfaceByName("fiber"));

    // Nouvelle convergence
    for(let i=0; i<2; i++) {
        [r1, r2, r3, r4].forEach(r => r.syncRoutingDaemons());
    }

    const routeR1Final = r1.getRoutes().find(r => ipToString(r.networkIp) === "172.16.0.0");
    if (routeR1Final && routeR1Final.cost === 1) {
        console.log(`✅ R1 a découvert le raccourci ! Nouvelle métrique : ${routeR1Final.cost}`);
    } else {
        console.error(`❌ Échec : R1 n'a pas optimisé sa route. Métrique actuelle : ${routeR1Final?.cost}`);
    }

    console.groupEnd();
}

// Exécution automatique pour le debug
if (typeof window !== 'undefined') {
    runScenario08Test();
}