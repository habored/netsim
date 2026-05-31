import { parseIpSlash, validateMask, parseMaskToInt } from "../network-utils.js";

/**
 * Suite de tests unitaires pour la validation des formats IP/Masque
 */
export function runNetworkUtilsTests() {
    console.group("🧪 Tests networkUtils : Parsing et Validation Masques");

    const cases = [
        { input: "192.168.1.1/24",  expectedIp: "192.168.1.1", expectedMask: "/24", valid: true },
        { input: "10.0.0.1/0",      expectedIp: "10.0.0.1",    expectedMask: "/0",   valid: true },
        { input: "172.16.0.1/32",   expectedIp: "172.16.0.1",  expectedMask: "/32",  valid: true },
        { input: "8.8.8.8",         expectedIp: "8.8.8.8",     expectedMask: "255.255.255.255", valid: true },
        { input: "any",             expectedIp: null,          expectedMask: null,   valid: true },
        // Cas invalides
        { input: "192.168.1.1/33",  expectedIp: "192.168.1.1", expectedMask: "/33",  valid: false },
        { input: "192.168.1.1/abc", expectedIp: "192.168.1.1", expectedMask: "/abc", valid: false },
        { input: "10.0.0.1/-1",     expectedIp: "10.0.0.1",    expectedMask: "/-1",  valid: false },
        // Cas spécifiques aux masques non-contigus (invalides en IPv4 standard)
        { input: "192.168.1.1/255.255.0.255", expectedIp: "192.168.1.1", expectedMask: "/255.255.0.255", valid: false },
        { input: "192.168.1.1/255.0.255.0",   expectedIp: "192.168.1.1", expectedMask: "/255.0.255.0",   valid: false }
    ];

    let successCount = 0;

    cases.forEach(c => {
        const result = parseIpSlash(c.input);
        const maskValidation = result.mask ? validateMask(result.mask) : { valid: true };
        
        const parseOk = result.ip === c.expectedIp && result.mask === c.expectedMask;
        const validOk = maskValidation.valid === c.valid;

        if (parseOk && validOk) {
            console.log(`✅ [PASS] "${c.input}" -> IP:${result.ip} MASK:${result.mask} (Validation: ${c.valid})`);
            successCount++;
        } else {
            console.error(`❌ [FAIL] "${c.input}"`);
            if (!parseOk) console.error(`   Erreur parsing: attendu IP:${c.expectedIp} MASK:${c.expectedMask}, obtenu IP:${result.ip} MASK:${result.mask}`);
            if (!validOk) console.error(`   Erreur validation: attendu ${c.valid}, obtenu ${maskValidation.valid}`);
        }
    });

    // Vérification spécifique de la conversion en entier pour /0 et /32
    const mask0 = parseMaskToInt("/0");
    const mask32 = parseMaskToInt("/32");
    
    if (mask0 === 0 && mask32 === 0xFFFFFFFF) {
        console.log("✅ [PASS] Conversion binaire /0 et /32 correcte.");
        successCount++;
    } else {
        console.error("❌ [FAIL] Erreur de conversion binaire pour les préfixes CIDR.");
    }

    // Vérification de la détection des masques non-contigus
    if (!validateMask("255.255.0.255").valid && validateMask("255.255.255.0").valid) {
        console.log("✅ [PASS] Détection des masques non-contigus opérationnelle.");
        successCount++;
    } else {
        console.error("❌ [FAIL] La validation des masques contigus a échoué.");
    }

    console.log(`\nRésultats : ${successCount}/${cases.length + 1} tests réussis.`);
    console.groupEnd();
}

// Exécution automatique si lancé dans un environnement de test
runNetworkUtilsTests();