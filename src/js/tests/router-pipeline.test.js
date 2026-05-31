import { Router } from "../devices.js";
import { Packet } from "../network-core.js";
import { ipToIntStrict } from "../networkUtils.js";

/**
 * Test unitaire : Vérification de l'ordre DNAT -> ACL Ingress
 */
function testDNATBeforeACL() {
    console.log("Démarrage du test : DNAT avant Ingress ACL...");

    // 1. Initialisation du routeur
    const router = new Router(1, "R1", 2);
    
    // 2. Configuration du NAT (Public: 200.0.0.1 -> Privé: 10.0.0.1)
    const publicIP = "200.0.0.1";
    const privateIP = "10.0.0.1";
    router.natEngine.addRule(publicIP, privateIP);

    // 3. Configuration du Firewall
    // On interdit l'accès à l'IP privée 10.0.0.1
    router.applyRoutingConfig({
        firewall: {
            defaultPolicy: "allow",
            accessRules: [
                {
                    src_ip: "0.0.0.0", src_mask: "0.0.0.0", // any
                    dst_ip: privateIP, dst_mask: "255.255.255.255",
                    protocol: "ICMP",
                    action: "deny"
                }
            ]
        }
    });

    // On ajoute une route pour que le paquet ne soit pas jeté par manque de route
    router.addRoute("0.0.0.0", "0.0.0.0", null, "eth1", 1);

    // 4. Création du paquet vers l'IP PUBLIQUE
    const pkt = new Packet("8.8.8.8", publicIP, "Hello", 64, "ICMP");

    // 5. Exécution du pipeline
    const result = router.executePipeline(pkt);

    // 6. Analyse du résultat
    if (result.action === "DROP" && result.reason === "FIREWALL_INGRESS") {
        console.log("✅ SUCCÈS : Le paquet a été bloqué par l'ACL après avoir été traduit (DNAT).");
    } else {
        console.error("❌ ÉCHEC : Le pipeline n'a pas appliqué le DNAT avant le filtrage.");
        console.error("Résultat obtenu :", result);
    }
}

testDNATBeforeACL();
