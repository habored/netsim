import { Router } from "../devices.js";
import { RIPManager } from "../../RIPManager.js";
import { normalizeIPv4Value } from "../network-utils.js";

/**
 * Test d'intégration pour le Scénario 11 : Redistribution RIP <-> OSPF
 * Valide la traduction des métriques et la prévention des boucles via Tags.
 */
export function testRedistributionLogic() {
    console.group("🧪 Test Intégration : Redistribution & Anti-Feedback");

    // 1. Initialisation du Routeur Frontière (ASBR)
    const r2 = new Router("R2-ASBR");
    r2.ripManager = new RIPManager(r2);
    
    // Configuration : Activer la redistribution bidirectionnelle
    r2.redistributor.enable('ospf', 'rip');
    r2.redistributor.enable('rip', 'ospf');

    // --- TEST 1 : OSPF vers RIP (Seed Metric & Tagging) ---
    console.log("Étape 1 : Injection d'une route OSPF dans le domaine RIP...");
    
    // On ajoute une route apprise via OSPF (Coût 50)
    const netOSPF = "10.60.2.0";
    r2.addRoute(netOSPF, "255.255.255.0", "10.0.1.2", "eth1", 50, "ospf");

    // Génération de l'annonce RIP pour les voisins RIP (via eth0)
    const ripUpdate = r2.ripManager.generateUpdatePayload(r2.getInterfaceByName("eth0"));
    const redistributedInRip = ripUpdate.find(u => u.networkIp === normalizeIPv4Value(netOSPF));

    if (redistributedInRip && redistributedInRip.cost === 1 && redistributedInRip.tag === "ospf") {
        console.log("✅ [PASS] Route OSPF redistribuée dans RIP avec Metric=1 et Tag='ospf'.");
    } else {
        console.error("❌ [FAIL] Erreur de redistribution OSPF -> RIP.", redistributedInRip);
    }

    // --- TEST 2 : Prévention du Route Feedback (Anti-boucle) ---
    console.log("Étape 2 : Vérification de la prévention du feedback...");

    /**
     * Scénario de boucle :
     * R2 a appris "Net_A" via OSPF.
     * R2 l'a envoyé à R1 via RIP (Tag: ospf).
     * Imaginez que R1 renvoie cette route à R2 via RIP.
     * R2 ne doit JAMAIS la ré-injecter dans OSPF.
     */
    const loopRoute = {
        networkIp: normalizeIPv4Value(netOSPF),
        networkMask: normalizeIPv4Value("255.255.255.0"),
        kind: "rip",
        tag: "ospf" // La route revient avec son tag d'origine
    };

    const shouldExitToOSPF = r2.redistributor.shouldRedistribute(loopRoute, "ospf");

    if (shouldExitToOSPF === false) {
        console.log("✅ [PASS] Anti-Feedback : La route tagguée 'ospf' est bloquée lors de la ré-injection vers OSPF.");
    } else {
        console.error("❌ [FAIL] Boucle détectée ! Le redistributeur a autorisé le feedback d'une route vers son origine.");
    }

    // --- TEST 3 : Redistribution Statique vers OSPF ---
    console.log("Étape 3 : Vérification de la métrique par défaut (Seed Metric)...");
    
    r2.addRoute("1.1.1.0", "255.255.255.0", null, "eth0", 1, "static");
    const staticRoute = r2.routingTable.find(r => r.networkIp === normalizeIPv4Value("1.1.1.0"));
    
    const translatedMetric = r2.redistributor.getTranslatedMetric(staticRoute, "ospf");
    
    if (translatedMetric === 20) { // Valeur configurée dans le constructeur pour OSPF (E2)
        console.log("✅ [PASS] Seed Metric OSPF (20) correctement appliquée aux routes statiques.");
    } else {
        console.error("❌ [FAIL] Métrique de redistribution incorrecte pour OSPF : " + translatedMetric);
    }

    // --- TEST 4 : Redistribution des routes CONNECTÉES ---
    console.log("Étape 4 : Vérification de la redistribution des réseaux connectés...");
    
    // Simulation d'une interface configurée
    r2.addInterface("eth2", "192.168.10.1", "255.255.255.0");
    
    const payloadWithConnected = r2.ripManager.generateUpdatePayload(r2.getInterfaceByName("eth0"));
    const connectedInRip = payloadWithConnected.find(u => u.networkIp === normalizeIPv4Value("192.168.10.0"));

    if (connectedInRip && connectedInRip.cost === 1) {
        console.log("✅ [PASS] Réseau connecté redistribué dans RIP (Métrique 1).");
    } else {
        console.error("❌ [FAIL] Les réseaux connectés ne sont pas redistribués par défaut.");
    }

    console.groupEnd();
}

// Auto-exécution si lancé dans l'environnement de test
if (typeof window !== 'undefined' && window.runTests) testRedistributionLogic();
